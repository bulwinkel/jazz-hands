"""Unit tests for the song tool: how it measures the drums, how it chooses the bar start, and --compare.

Run them with `npm run test-songs`. They read no audio file and start no browser: the drum tests make
their own sound.
"""

import dataclasses
import itertools
import unittest
from dataclasses import dataclass
from unittest import mock

import librosa
import numpy as np

import add_song
from add_song import (
    ANALYSIS_RATE,
    CHORDS_WEIGHT,
    DRUMS_WEIGHT,
    RISES_WEIGHT,
    BarClue,
    beat_list_ends,
    choose_bar_start,
    chords_clue,
    drum_shares,
    drums_clue,
    onset_envelopes,
    rises_clue,
    snare_envelope,
    start_clue,
)


def rises(*beats: int) -> BarClue:
    """Returns a level-rises clue for the given beats, or an undecided one."""
    return BarClue('level rises', RISES_WEIGHT, beats, '')


def chords(*beats: int) -> BarClue:
    """Returns a chord clue for the given beat or pair of beats, or an undecided one."""
    return BarClue('chord changes', CHORDS_WEIGHT, beats, '')


def drums(*beats: int) -> BarClue:
    """Returns a drum clue for the given pair of beats, or an undecided one."""
    return BarClue('drums', DRUMS_WEIGHT, beats, '')


class DrumsClueTest(unittest.TestCase):
    """The kick on beats 1 and 3 and the snare on 2 and 4 point to a pair of beats."""

    def test_kick_on_beats_0_and_2_and_snare_between(self) -> None:
        # All Aboard, measured by hand: kick and snare shares on beats 0 to 3 of the music.
        clue = drums_clue(np.array([21.0, 4, 25, 4]), np.array([10.0, 17, 10, 18]))
        self.assertEqual(clue.beats, (0, 2))
        self.assertEqual(clue.verdict, 'beat 0 or 2')

    def test_kick_on_beats_1_and_3_and_snare_between(self) -> None:
        clue = drums_clue(np.array([0.4, 1.9, 0.6, 1.5]), np.array([1.4, 1.0, 1.3, 0.9]))
        self.assertEqual(clue.beats, (1, 3))

    def test_kick_on_every_beat_decides_nothing(self) -> None:
        # Hey-Ho, Jonah: the kick and the clap are equally strong on every beat.
        clue = drums_clue(np.array([22.0, 22, 22, 22]), np.array([15.0, 16, 13, 16]))
        self.assertEqual(clue.beats, ())
        self.assertIn('no clear kick pattern', clue.detail)

    def test_kick_must_lead_by_the_ratio(self) -> None:
        snare = np.array([1.0, 2.0, 1.0, 2.0])
        # 12 against 10 is 1.2 times: too little. 10.4 against 8 is 1.3 times: enough.
        self.assertEqual(drums_clue(np.array([6.0, 5, 6, 5]), snare).beats, ())
        self.assertEqual(drums_clue(np.array([5.2, 4, 5.2, 4]), snare).beats, (0, 2))

    def test_snare_on_the_kick_beats_decides_nothing(self) -> None:
        clue = drums_clue(np.array([21.0, 4, 25, 4]), np.array([18.0, 10, 17, 10]))
        self.assertEqual(clue.beats, ())
        self.assertIn('no clear backbeat', clue.detail)

    def test_snare_must_answer_by_the_ratio(self) -> None:
        kick = np.array([30.0, 10, 30, 10])
        # 52 against 48 is 1.08 times: noise in the snare band, not a backbeat.
        clue = drums_clue(kick, np.array([24.0, 26, 24, 26]))
        self.assertEqual(clue.beats, ())
        self.assertIn('the snare hits beats 1 and 3 1.08 times as hard as beats 0 and 2 (it must be 1.25): '
                      'no clear backbeat.', clue.detail)
        # 55.5 against 44.5 is 1.247 times: just too little. 56 against 44 is 1.27 times: enough.
        self.assertEqual(drums_clue(kick, np.array([22.25, 27.75, 22.25, 27.75])).beats, ())
        clue = drums_clue(kick, np.array([22.0, 28, 22, 28]))
        self.assertEqual(clue.beats, (0, 2))
        self.assertIn('1.27 times as hard as beats 0 and 2: a backbeat.', clue.detail)

    def test_kick_pattern_with_a_weak_snare_decides_nothing(self) -> None:
        # Nebuchadnezzar's Dream: a clear kick on beat 1, but the snare band leans on beats 0 and 2 by
        # only 1.13 times. The old rule took any lean as a backbeat.
        clue = drums_clue(np.array([15.9, 52.5, 13.9, 17.6]), np.array([27.1, 25.2, 25.9, 21.8]))
        self.assertEqual(clue.beats, ())
        self.assertIn('no clear backbeat', clue.detail)

    def test_snare_alone_decides_nothing(self) -> None:
        clue = drums_clue(np.array([1.0, 1.0, 1.0, 1.0]), np.array([1.0, 3.0, 1.0, 3.0]))
        self.assertEqual(clue.beats, ())

    def test_no_drums_decides_nothing(self) -> None:
        self.assertEqual(drums_clue(np.zeros(4), np.zeros(4)).beats, ())

    def test_detail_shows_the_shares(self) -> None:
        clue = drums_clue(np.array([30.0, 10, 40, 20]), np.array([10.0, 40, 10, 40]))
        self.assertIn('beat 0: 30%   beat 1: 10%   beat 2: 40%   beat 3: 20%', clue.detail)
        self.assertIn('beat 0: 10%   beat 1: 40%   beat 2: 10%   beat 3: 40%', clue.detail)


class ChordsClueTest(unittest.TestCase):
    """Chords change on the bar start, often at the half bar too, seldom on the beats next to it."""

    def test_clear_change_on_the_bar_start(self) -> None:
        # The Valley Waits.
        self.assertEqual(chords_clue(np.array([1.55, 0.80, 0.76, 0.90])).beats, (0,))

    def test_change_at_the_half_bar_does_not_block_the_choice(self) -> None:
        # Hey-Ho, Jonah: most change on beat 2, nearly as much on beat 0, least on beat 1.
        self.assertEqual(chords_clue(np.array([1.10, 0.74, 1.29, 0.87])).beats, (2,))

    def test_change_on_a_neighbour_decides_nothing(self) -> None:
        # Todo Bueno: the chords change on beats 1 and 2 alike.
        self.assertEqual(chords_clue(np.array([0.78, 1.35, 1.16, 0.72])).beats, ())

    def test_neighbours_wrap_round_the_bar(self) -> None:
        # Beat 0 is next to beat 3.
        self.assertEqual(chords_clue(np.array([1.20, 0.50, 1.00, 1.40])).beats, ())
        self.assertEqual(chords_clue(np.array([0.69, 1.03, 0.83, 1.46])).beats, (3,))

    def test_no_change_decides_nothing(self) -> None:
        self.assertEqual(chords_clue(np.zeros(4)).beats, ())

    def test_near_tie_at_the_half_bar_points_to_the_pair(self) -> None:
        # Two chords per bar: beat 2 changes only 1.02 times as much as beat 0.
        clue = chords_clue(np.array([0.50, 0.20, 0.51, 0.20]))
        self.assertEqual(clue.beats, (0, 2))
        self.assertEqual(clue.verdict, 'beat 0 or 2')
        self.assertIn('only 1.02 times as much as beat 0, half a bar away (it must be 1.1): a tie, '
                      'so the chords point to both.', clue.detail)

    def test_exact_tie_at_the_half_bar_points_to_the_pair(self) -> None:
        # The largest change comes first in the bar, but beat 3 has the same evidence as beat 1.
        self.assertEqual(chords_clue(np.array([0.1, 2.0, 0.1, 2.0])).beats, (1, 3))

    def test_half_bar_ratio_decides_between_one_beat_and_the_pair(self) -> None:
        # Jericho Fell: beat 0 changes 1.06 times as much as beat 2, a tie.
        self.assertEqual(chords_clue(np.array([1.228, 0.738, 1.164, 0.868])).beats, (0, 2))
        # 1.09 times is a tie, 1.11 times is not.
        self.assertEqual(chords_clue(np.array([1.09, 0.5, 1.0, 0.5])).beats, (0, 2))
        self.assertEqual(chords_clue(np.array([1.11, 0.5, 1.0, 0.5])).beats, (0,))


class ChooseBarStartTest(unittest.TestCase):
    """The clues vote with their weights. Confidence tells how far they agree."""

    def test_drums_and_chords_beat_the_rises_and_the_song_start(self) -> None:
        # All Aboard: the old weights chose beat 3 from the level rises.
        choice = choose_bar_start([start_clue(), rises(3), chords(2), drums(0, 2)])
        self.assertEqual(choice.first_downbeat, 2)
        self.assertEqual(choice.confidence, 'medium')
        self.assertEqual(choice.votes, (2.5, 0.0, 4.0, 1.0))

    def test_strong_clues_agree_against_the_song_start(self) -> None:
        # Nebuchadnezzar's Dream: the music starts with a pickup.
        choice = choose_bar_start([start_clue(), rises(), chords(1), drums(1, 3)])
        self.assertEqual(choice.first_downbeat, 1)
        self.assertEqual(choice.confidence, 'high')
        self.assertEqual(choice.doubt, '')

    def test_clear_chords_beat_the_song_start(self) -> None:
        # Joseph's Coat of Many Colors.
        choice = choose_bar_start([start_clue(), rises(), chords(1), drums()])
        self.assertEqual(choice.first_downbeat, 1)
        self.assertEqual(choice.confidence, 'medium')

    def test_chords_beat_a_narrow_lead_of_the_rises(self) -> None:
        # Hey-Ho, Jonah.
        choice = choose_bar_start([start_clue(), rises(1), chords(2), drums()])
        self.assertEqual(choice.first_downbeat, 2)
        self.assertEqual(choice.confidence, 'medium')

    def test_song_start_picks_from_the_drums_pair(self) -> None:
        choice = choose_bar_start([start_clue(), rises(), chords(), drums(0, 2)])
        self.assertEqual(choice.first_downbeat, 0)
        self.assertEqual(choice.confidence, 'medium')

    def test_drums_alone_leave_two_beats_open(self) -> None:
        choice = choose_bar_start([start_clue(), rises(), chords(), drums(1, 3)])
        self.assertEqual(choice.first_downbeat, 1)
        self.assertEqual(choice.confidence, 'low')
        self.assertIn('beat 1 from beat 3', choice.doubt)
        self.assertIn('Beat 3 has as much weight', choice.statement)

    def test_chords_against_drums_is_low(self) -> None:
        choice = choose_bar_start([start_clue(), rises(), chords(1), drums(0, 2)])
        self.assertEqual(choice.first_downbeat, 0)
        self.assertEqual(choice.confidence, 'low')
        self.assertEqual(choice.doubt, 'Strong bar-start clues disagree.')

    def test_rises_side_with_the_chords_against_the_drums(self) -> None:
        choice = choose_bar_start([start_clue(), rises(1), chords(1), drums(0, 2)])
        self.assertEqual(choice.first_downbeat, 1)
        self.assertEqual(choice.confidence, 'low')

    def test_all_clues_agree(self) -> None:
        choice = choose_bar_start([start_clue(), rises(0), chords(0), drums(0, 2)])
        self.assertEqual(choice.first_downbeat, 0)
        self.assertEqual(choice.confidence, 'high')
        self.assertIn('Against: none.', choice.statement)

    def test_song_start_alone_is_not_certain(self) -> None:
        choice = choose_bar_start([start_clue(), rises(), chords(), drums()])
        self.assertEqual(choice.first_downbeat, 0)
        self.assertEqual(choice.confidence, 'medium')
        self.assertIn('Undecided: level rises, chord changes, drums.', choice.statement)

    def test_half_bar_tie_in_the_chords_is_not_certain(self) -> None:
        # The old rule took beat 2 with high confidence on a 2% lead of the chords. Now the chords and
        # the drums point to beats 0 and 2 alike, and only the song start picks one.
        choice = choose_bar_start([start_clue(), rises(), chords_clue(np.array([0.50, 0.20, 0.51, 0.20])),
                                   drums(0, 2)])
        self.assertEqual(choice.first_downbeat, 0)
        self.assertEqual(choice.confidence, 'medium')
        self.assertEqual(choice.votes, (4.5, 0.0, 4.0, 0.0))
        self.assertEqual(choice.doubt, 'The music does not tell beat 0 from beat 2, half a bar away.')
        self.assertIn('For beat 0: song start, chord changes (beat 0 or 2), drums (beat 0 or 2).', choice.statement)
        self.assertIn('The music gives beat 2, half a bar away, as much weight: only the song start picks beat 0.',
                      choice.statement)

    def test_exact_half_bar_tie_is_reported_as_a_tie(self) -> None:
        # The old rule took beat 1 with high confidence, and a song with bars from beat 3 was marked two
        # beats early.
        choice = choose_bar_start([start_clue(), rises(), chords_clue(np.array([0.1, 2.0, 0.1, 2.0])),
                                   drums(1, 3)])
        self.assertEqual(choice.first_downbeat, 1)
        self.assertEqual(choice.confidence, 'low')
        self.assertEqual(choice.doubt, 'The clues do not tell beat 1 from beat 3, half a bar away.')
        self.assertIn('Beat 3 has as much weight.', choice.statement)

    def test_rises_pick_from_the_chords_pair(self) -> None:
        # The rises tell the two beats apart, so the choice can be certain.
        choice = choose_bar_start([start_clue(), rises(2), chords(0, 2), drums(0, 2)])
        self.assertEqual(choice.first_downbeat, 2)
        self.assertEqual(choice.confidence, 'high')

    def test_chords_pair_alone_leaves_the_song_start_to_pick(self) -> None:
        # Jericho Fell: the kick hits every beat and the rises do not decide.
        choice = choose_bar_start([start_clue(), rises(), chords(0, 2), drums()])
        self.assertEqual(choice.first_downbeat, 0)
        self.assertEqual(choice.confidence, 'medium')
        self.assertIn('beat 0 from beat 2, half a bar away', choice.doubt)

    def test_rises_with_the_drums_are_certain(self) -> None:
        # Job, Hold On: the chords are undecided.
        choice = choose_bar_start([start_clue(), rises(0), chords(), drums(0, 2)])
        self.assertEqual(choice.first_downbeat, 0)
        self.assertEqual(choice.confidence, 'high')


# --- The drums, measured on synthetic sound ---

BEAT_SEC = 0.5
FIRST_BEAT_SEC = 0.5
BARS = 8


def click_track(thump_beats: tuple[int, ...], burst_beats: tuple[int, ...],
                chord: bool = False) -> tuple[np.ndarray, np.ndarray]:
    """Returns 8 bars of a synthetic drum part at 120 beats per minute, and its beat times.

    A thump is a 60 Hz tone that dies away in about 0.1 s: a kick. A burst is noise that dies away in
    about 0.05 s: a snare. They go on the beats of the bar, 0 to 3, in `thump_beats` and
    `burst_beats`. With `chord`, a held chord of three tones sounds through the whole track.
    """
    beats = FIRST_BEAT_SEC + np.arange(BARS * 4) * BEAT_SEC
    samples = np.zeros(int((beats[-1] + 1.0) * ANALYSIS_RATE))
    thump_sec = np.arange(int(0.15 * ANALYSIS_RATE)) / ANALYSIS_RATE
    thump = 0.8 * np.sin(2 * np.pi * 60 * thump_sec) * np.exp(-thump_sec / 0.04)
    burst_sec = np.arange(int(0.08 * ANALYSIS_RATE)) / ANALYSIS_RATE
    burst = 0.3 * np.random.default_rng(1).standard_normal(len(burst_sec)) * np.exp(-burst_sec / 0.02)
    for index, beat in enumerate(beats):
        at = int(beat * ANALYSIS_RATE)
        if index % 4 in thump_beats:
            samples[at:at + len(thump)] += thump
        if index % 4 in burst_beats:
            samples[at:at + len(burst)] += burst
    if chord:
        time_sec = np.arange(len(samples)) / ANALYSIS_RATE
        tones = sum(np.sin(2 * np.pi * hz * time_sec) for hz in (220.0, 277.2, 329.6))
        samples += 0.1 * tones * np.minimum(1, time_sec / 0.3)
    return samples, beats


def measured_shares(samples: np.ndarray, beats: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Returns the kick and snare shares on each beat of the bar, measured as the tool measures a song."""
    _, percussive = librosa.effects.hpss(samples)
    return drum_shares(onset_envelopes(samples, percussive).kick, snare_envelope(percussive), beats)


class DrumSharesTest(unittest.TestCase):
    """The tool's own measuring finds the drum pattern of a synthetic drum part."""

    def assert_between(self, values: np.ndarray, low: float, high: float) -> None:
        """Checks that every value lies between `low` and `high`."""
        for value in values:
            self.assertGreaterEqual(value, low)
            self.assertLessEqual(value, high)

    def test_kick_on_beats_0_and_2_and_snare_between(self) -> None:
        kick, snare = measured_shares(*click_track((0, 2), (1, 3)))
        self.assert_between(kick[[0, 2]], 35, 40)
        self.assert_between(kick[[1, 3]], 10, 15)
        self.assert_between(snare[[1, 3]], 40, 45)
        self.assert_between(snare[[0, 2]], 5, 10)
        self.assertEqual(drums_clue(kick, snare).beats, (0, 2))

    def test_bars_are_counted_from_the_first_beat(self) -> None:
        # The same track, with the music taken to start one beat later: the kick is now on beats 1 and 3.
        samples, beats = click_track((0, 2), (1, 3))
        kick, snare = measured_shares(samples, beats[1:])
        self.assert_between(kick[[1, 3]], 35, 40)
        self.assertEqual(drums_clue(kick, snare).beats, (1, 3))

    def test_kick_on_every_beat_decides_nothing(self) -> None:
        kick, snare = measured_shares(*click_track((0, 1, 2, 3), ()))
        self.assert_between(kick, 24, 26)
        clue = drums_clue(kick, snare)
        self.assertEqual(clue.beats, ())
        self.assertIn('no clear kick pattern', clue.detail)

    def test_bursts_on_every_beat_are_no_backbeat(self) -> None:
        # A clear kick on beats 0 and 2, and hi-hats on every beat: no backbeat to confirm the kick.
        kick, snare = measured_shares(*click_track((0, 2), (0, 1, 2, 3)))
        self.assert_between(kick[[0, 2]], 30, 40)
        self.assert_between(snare, 20, 30)
        clue = drums_clue(kick, snare)
        self.assertEqual(clue.beats, ())
        self.assertIn('no clear backbeat', clue.detail)

    def test_held_chord_with_no_drums_decides_nothing(self) -> None:
        kick, snare = measured_shares(*click_track((), (), chord=True))
        clue = drums_clue(kick, snare)
        self.assertEqual(clue.beats, ())
        self.assertIn('no clear kick pattern', clue.detail)

    def test_silence_decides_nothing(self) -> None:
        kick, snare = measured_shares(*click_track((), ()))
        self.assertEqual(list(kick), [0, 0, 0, 0])
        clue = drums_clue(kick, snare)
        self.assertEqual(clue.beats, ())
        self.assertIn('no drums', clue.detail)


# --- The 15 songs in public/songs ---


@dataclass(frozen=True)
class MeasuredSong:
    """The bar-start clue numbers the tool measured for one song in public/songs, and its right bar start."""

    title: str
    # The beats that start the bars, verified by ear, in the tool's own numbering from the first beat of
    # the music.
    right: tuple[int, ...]
    # How many of the level rises fall on each beat of the bar, 0 to 3.
    rises: tuple[float, ...]
    # How much chords and bass change on each beat of the bar. 1 is the mean over all beats.
    chords: tuple[float, ...]
    # The share of the kick and of the snare on each beat of the bar, in percent.
    kick: tuple[float, ...]
    snare: tuple[float, ...]
    # What the rule gives today: the chord clue's beats, the choice and its confidence.
    chord_beats: tuple[int, ...]
    choice: int
    confidence: str

    def clues(self) -> list[BarClue]:
        """Returns the four clues from the measured numbers, with the tool's weights and thresholds."""
        return [start_clue(), rises_clue(np.array(self.rises, dtype=float)), chords_clue(np.array(self.chords)),
                drums_clue(np.array(self.kick), np.array(self.snare))]


# Measured by the tool on 2026-11-13 with no --first-downbeat. Each song needs the options its row in the
# README gives (--beats for The Wilderness Knows, --half-beat shift for Job, Hold On).
SONGS = [
    MeasuredSong('Blessed on the Hillside', (0,), rises=(7, 1, 1, 1), chords=(1.329, 0.967, 0.751, 0.949),
                 kick=(17.5, 25.4, 33.1, 24), snare=(26.9, 20.6, 30, 22.5),
                 chord_beats=(0,), choice=0, confidence='high'),
    MeasuredSong('Todo Bueno', (0,), rises=(2, 0, 1, 3), chords=(0.776, 1.345, 1.156, 0.719),
                 kick=(25.7, 21.7, 29.3, 23.3), snare=(29, 23, 24.7, 23.2),
                 chord_beats=(), choice=0, confidence='medium'),
    MeasuredSong('From the Garden to the Cross', (0,), rises=(7, 0, 1, 2), chords=(2.014, 0.605, 0.526, 0.847),
                 kick=(30.9, 22.9, 22.4, 23.8), snare=(19.9, 28.2, 21.7, 30.3),
                 chord_beats=(0,), choice=0, confidence='high'),
    # The tool writes half the manifest's tempo, so bars from beat 0 or from beat 2 both fall on the
    # manifest's bar starts.
    MeasuredSong('Drum and Bass Violins', (0, 2), rises=(0, 2, 2, 2), chords=(0.941, 0.675, 1.704, 0.688),
                 kick=(27.9, 16.5, 39, 16.6), snare=(26, 25.1, 27.9, 21),
                 chord_beats=(2,), choice=2, confidence='medium'),
    # The tool lists one beat before the manifest's first beat, so the manifest's bar start 0 is beat 1 here.
    MeasuredSong('All Eyes on Us', (1,), rises=(1, 2, 4, 0), chords=(0.955, 1.548, 0.587, 0.905),
                 kick=(14.2, 43.8, 11.9, 30.1), snare=(29.5, 21, 28.3, 21.2),
                 chord_beats=(1,), choice=1, confidence='medium'),
    # The tool lists two beats before the manifest's first beat.
    MeasuredSong('Return to the Lord', (2,), rises=(1, 2, 7, 0), chords=(1.004, 0.834, 1.469, 0.693),
                 kick=(26.2, 25, 32.1, 16.7), snare=(24.4, 24.5, 21.8, 29.3),
                 chord_beats=(2,), choice=2, confidence='high'),
    MeasuredSong('The Wilderness Knows', (3,), rises=(2, 0, 4, 4), chords=(0.686, 1.034, 0.827, 1.458),
                 kick=(15.4, 24.9, 18.5, 41.2), snare=(28.1, 22.6, 24.9, 24.4),
                 chord_beats=(3,), choice=3, confidence='high'),
    MeasuredSong('Job, Hold On', (0,), rises=(8, 0, 1, 1), chords=(1.245, 0.725, 0.954, 1.073),
                 kick=(55.8, 6.1, 8.6, 29.5), snare=(17.1, 30.4, 21.8, 30.7),
                 chord_beats=(), choice=0, confidence='high'),
    MeasuredSong('All Aboard', (2,), rises=(1, 0, 4, 5), chords=(1.108, 0.645, 1.653, 0.594),
                 kick=(31.6, 11.5, 41.5, 15.5), snare=(19.2, 28.7, 21, 31.1),
                 chord_beats=(2,), choice=2, confidence='medium'),
    MeasuredSong("Nebuchadnezzar's Dream", (1,), rises=(2, 4, 4, 0), chords=(0.679, 1.383, 1.023, 0.915),
                 kick=(15.9, 52.5, 13.9, 17.6), snare=(27.1, 25.2, 25.9, 21.8),
                 chord_beats=(1,), choice=1, confidence='medium'),
    MeasuredSong('The Valley Waits', (0,), rises=(3, 2, 2, 2), chords=(1.548, 0.797, 0.757, 0.897),
                 kick=(43.2, 18.3, 14.9, 23.6), snare=(21.8, 28.8, 24.3, 25),
                 chord_beats=(0,), choice=0, confidence='medium'),
    MeasuredSong('Part the Sea', (2,), rises=(3, 2, 5, 0), chords=(0.933, 1.125, 1.169, 0.771),
                 kick=(25.4, 24.8, 26.1, 23.8), snare=(25.1, 24.5, 24.3, 26.1),
                 chord_beats=(), choice=2, confidence='medium'),
    MeasuredSong('Hey-Ho, Jonah', (2,), rises=(1, 2, 0, 0), chords=(1.105, 0.735, 1.289, 0.874),
                 kick=(25.1, 24.6, 25.5, 24.8), snare=(21.1, 27.2, 25.3, 26.4),
                 chord_beats=(2,), choice=2, confidence='medium'),
    MeasuredSong("Joseph's Coat of Many Colors", (1,), rises=(0, 3, 1, 1), chords=(1.068, 1.555, 0.626, 0.749),
                 kick=(31, 25.6, 22.5, 20.9), snare=(23.5, 26.2, 25, 25.3),
                 chord_beats=(1,), choice=1, confidence='medium'),
    # The chords change as much at the half bar as on the bar start, and nothing else in the music tells
    # beat 0 from beat 2: the song start picks beat 0, and the tool warns.
    MeasuredSong('Jericho Fell', (0,), rises=(0, 1, 4, 2), chords=(1.228, 0.738, 1.164, 0.868),
                 kick=(26.4, 23, 27.1, 23.5), snare=(22.6, 27.2, 22.5, 27.6),
                 chord_beats=(0, 2), choice=0, confidence='medium'),
]


def wrong_songs(choices: list[int]) -> set[str]:
    """Returns the titles of the songs whose chosen bar start, one per song in SONGS, is wrong."""
    return {song.title for song, choice in zip(SONGS, choices) if choice not in song.right}


class SongTableTest(unittest.TestCase):
    """The rule gives each of the 15 songs its right bar start, with the confidence it gives today."""

    def test_each_song_gets_its_choice_and_confidence(self) -> None:
        for song in SONGS:
            with self.subTest(song.title):
                clues = song.clues()
                choice = choose_bar_start(clues)
                self.assertEqual(clues[2].beats, song.chord_beats)
                self.assertEqual((choice.first_downbeat, choice.confidence), (song.choice, song.confidence))
                self.assertIn(choice.first_downbeat, song.right)

    def test_a_half_bar_tie_is_named(self) -> None:
        choice = choose_bar_start(SONGS[-1].clues())
        self.assertEqual(choice.doubt, 'The music does not tell beat 0 from beat 2, half a bar away.')


# The values tried for each weight and threshold of the rule, one at a time: weights from 0 to 4 in steps
# of 0.05, ratios from 1 to 2 in steps of 0.01.
WEIGHT_STEPS = tuple(float(value) for value in np.round(np.arange(0, 4.001, 0.05), 2))
RATIO_STEPS = tuple(float(value) for value in np.round(np.arange(1, 2.001, 0.01), 2))
RULE_STEPS = {
    'START_WEIGHT': WEIGHT_STEPS,
    'RISES_WEIGHT': WEIGHT_STEPS,
    'CHORDS_WEIGHT': WEIGHT_STEPS,
    'DRUMS_WEIGHT': WEIGHT_STEPS,
    'RISE_ONE_EARLY_WEIGHT': WEIGHT_STEPS,
    'RISE_DECISIVE_RATIO': RATIO_STEPS,
    'CHORD_DECISIVE_RATIO': RATIO_STEPS,
    'CHORD_HALF_BAR_RATIO': RATIO_STEPS,
    'KICK_DECISIVE_RATIO': RATIO_STEPS,
    'SNARE_DECISIVE_RATIO': RATIO_STEPS,
    'STRONG_WEIGHT': WEIGHT_STEPS,
    'MINOR_WEIGHT': WEIGHT_STEPS,
    'CERTAIN_WEIGHT': WEIGHT_STEPS,
}


@dataclass(frozen=True)
class Step:
    """The rule with one weight or threshold set to one value: the songs it chooses wrong."""

    value: float
    wrong: frozenset[str]
    # The songs it chooses wrong with high confidence.
    wrong_and_sure: frozenset[str]


def steps(name: str) -> list[Step]:
    """Returns the rule's result for each value of RULE_STEPS[name], with everything else as it is."""
    results = []
    for value in RULE_STEPS[name]:
        with mock.patch.object(add_song, name, value):
            choices = [choose_bar_start(song.clues()) for song in SONGS]
        wrong = wrong_songs([choice.first_downbeat for choice in choices])
        sure = {song.title for song, choice in zip(SONGS, choices)
                if song.title in wrong and choice.confidence == 'high'}
        results.append(Step(value, frozenset(wrong), frozenset(sure)))
    return results


def first_flip(results: list[Step], now: float, direction: int, ignore: str = '') -> Step | None:
    """Returns the first value, from `now` downward (-1) or upward (1), at which some song is chosen
    wrong, leaving out the song titled `ignore`. None when no song is chosen wrong on the way."""
    ahead = [step for step in results if (step.value - now) * direction > 1e-9]
    for step in sorted(ahead, key=lambda step: step.value * direction):
        if step.wrong - {ignore}:
            return step
    return None


class RuleSteps:
    """The rule's result for every weight and threshold value tried, computed once for the tests."""

    results: dict[str, list[Step]] = {}

    @classmethod
    def of(cls, name: str) -> list[Step]:
        """Returns steps(name), computed on first use."""
        if name not in cls.results:
            cls.results[name] = steps(name)
        return cls.results[name]


# How far each weight and threshold may move on its own before the rule chooses one of the 15 songs
# wrong. For each: the first value below today's at which a song flips, and the first value above, with
# the songs that flip there. None: no song flips in the range tried.
#
# In words:
# - The weights need only their order, song start < level rises < chords. Part the Sea needs the rises to
#   outweigh the song start, and Hey-Ho, Jonah needs the chords to outweigh the rises (which point to
#   beat 1 there). Each weight may move by just under a factor of 2 before the order breaks.
# - The drums, their weight and their two ratios change no choice of the 15 songs. They only make Job,
#   Hold On certain.
# - CHORD_DECISIVE_RATIO sits in a narrow gap: Todo Bueno's chords lean to beat 1, the wrong beat, by
#   1.16, and Nebuchadnezzar's Dream needs its chords, which pick beat 1 by 1.35. The ratio may move only
#   from 1.25 down to 1.17 or up to 1.35.
# - CHORD_HALF_BAR_RATIO may rise only to 1.16: Hey-Ho, Jonah's chords tell beat 2 from beat 0 by 1.17.
# - The rises' two thresholds: Jericho Fell's rises lean to beat 2, the half bar, and Part the Sea needs
#   its rises to decide.
# - The confidence thresholds change no choice.
EDGES = {
    'START_WEIGHT': (None, (1.0, {'Part the Sea'})),
    'RISES_WEIGHT': ((0.5, {'Part the Sea'}), (2.0, {'Hey-Ho, Jonah'})),
    'CHORDS_WEIGHT': ((1.0, {'Hey-Ho, Jonah'}), None),
    'DRUMS_WEIGHT': (None, None),
    'RISE_ONE_EARLY_WEIGHT': ((0.2, {'Jericho Fell'}), (0.8, {'Part the Sea'})),
    'RISE_DECISIVE_RATIO': ((1.12, {'Jericho Fell'}), (1.72, {'Part the Sea'})),
    'CHORD_DECISIVE_RATIO': ((1.16, {'Todo Bueno'}), (1.36, {"Nebuchadnezzar's Dream"})),
    'CHORD_HALF_BAR_RATIO': (None, (1.17, {'Hey-Ho, Jonah'})),
    'KICK_DECISIVE_RATIO': (None, None),
    'SNARE_DECISIVE_RATIO': (None, None),
    'STRONG_WEIGHT': (None, None),
    'MINOR_WEIGHT': (None, None),
    'CERTAIN_WEIGHT': (None, None),
}

# Where the first wrong choice also comes with high confidence. At both, Jericho Fell's rises become
# decisive for beat 2 and pick it from the chords' pair.
SURE_FLIPS = {('RISE_ONE_EARLY_WEIGHT', 0.2), ('RISE_DECISIVE_RATIO', 1.12)}


class MarginTest(unittest.TestCase):
    """How far the weights and thresholds sit from a value that chooses a song wrong."""

    def test_how_far_each_weight_and_threshold_may_move(self) -> None:
        self.assertEqual(set(EDGES), set(RULE_STEPS))
        for name, (below, above) in EDGES.items():
            now = getattr(add_song, name)
            with self.subTest(name):
                for direction, expected in ((-1, below), (1, above)):
                    step = first_flip(RuleSteps.of(name), now, direction)
                    found = None if step is None else (step.value, set(step.wrong))
                    self.assertEqual(found, expected)

    def test_where_a_wrong_choice_is_also_sure(self) -> None:
        sure = set()
        for name in RULE_STEPS:
            for direction in (-1, 1):
                step = first_flip(RuleSteps.of(name), getattr(add_song, name), direction)
                if step is not None and step.wrong_and_sure:
                    sure.add((name, step.value))
        self.assertEqual(sure, SURE_FLIPS)


# Leave-one-out, for the thresholds one at a time and for the weights together. A song that the other 14
# songs already pin down follows from them: any value they allow chooses it right too. Where a song alone
# sets an edge, a rule fitted to the other 14 could choose it wrong. These are the edges each song sets
# alone, and where the edge would be without that song.
LONE_EDGES = {
    ('START_WEIGHT', 'Part the Sea'): (1.0, 2.0),
    ('RISES_WEIGHT', 'Part the Sea'): (0.5, None),
    ('RISES_WEIGHT', 'Hey-Ho, Jonah'): (2.0, None),
    ('CHORDS_WEIGHT', 'Hey-Ho, Jonah'): (1.0, 0.5),
    ('RISE_ONE_EARLY_WEIGHT', 'Jericho Fell'): (0.2, 0.0),
    ('RISE_ONE_EARLY_WEIGHT', 'Part the Sea'): (0.8, None),
    ('RISE_DECISIVE_RATIO', 'Jericho Fell'): (1.12, 1.0),
    ('RISE_DECISIVE_RATIO', 'Part the Sea'): (1.72, None),
    ('CHORD_DECISIVE_RATIO', 'Todo Bueno'): (1.16, None),
    ('CHORD_DECISIVE_RATIO', "Nebuchadnezzar's Dream"): (1.36, 1.46),
    ('CHORD_HALF_BAR_RATIO', 'Hey-Ho, Jonah'): (1.17, 1.5),
}

# The four weights tried together: each from 0.5 to 4 in steps of 0.5.
WEIGHT_GRID = (0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0)
# Of the weight sets that choose the other 14 songs right, the share that also chooses each song right.
# 13 songs follow from the others under every such set. Part the Sea and Hey-Ho, Jonah do not: they alone
# fix the order of the weights.
SHARE_RIGHT_FROM_THE_OTHERS = {
    'Part the Sea': 0.4,
    'Hey-Ho, Jonah': 0.427,
}


class LeaveOneOutTest(unittest.TestCase):
    """Each song is chosen right by any rule fitted to the other 14, except where it alone sets an edge."""

    def test_thresholds_and_weights_one_at_a_time(self) -> None:
        lone = {}
        for name in RULE_STEPS:
            now = getattr(add_song, name)
            for song in SONGS:
                for direction in (-1, 1):
                    # The edge the other 14 songs set, and the first value before it where this song flips.
                    others = first_flip(RuleSteps.of(name), now, direction, ignore=song.title)
                    own = next((step for step in sorted(RuleSteps.of(name), key=lambda step: step.value * direction)
                                if (step.value - now) * direction > 1e-9 and song.title in step.wrong), None)
                    if own is not None and (others is None or (others.value - own.value) * direction > 1e-9):
                        lone[name, song.title] = (own.value, None if others is None else others.value)
        self.assertEqual(lone, LONE_EDGES)

    def test_weights_together(self) -> None:
        clues = [song.clues() for song in SONGS]
        right = []
        for weights in itertools.product(WEIGHT_GRID, repeat=4):
            choices = [choose_bar_start([dataclasses.replace(clue, weight=weight)
                                         for clue, weight in zip(song_clues, weights)])
                       for song_clues in clues]
            wrong = wrong_songs([choice.first_downbeat for choice in choices])
            right.append([song.title not in wrong for song in SONGS])
        right = np.array(right)
        for index, song in enumerate(SONGS):
            with self.subTest(song.title):
                fit_the_others = np.delete(right, index, axis=1).all(axis=1)
                share = float(right[fit_the_others, index].mean())
                self.assertAlmostEqual(share, SHARE_RIGHT_FROM_THE_OTHERS.get(song.title, 1.0), places=3)


class BeatListEndsTest(unittest.TestCase):
    """--compare tells how our beat list and theirs line up at both ends."""

    def test_same_beats(self) -> None:
        beats = np.arange(10) * 0.5
        self.assertEqual(beat_list_ends(beats, beats), 'Our first beat is their beat index 0, our last is their 9.')

    def test_our_list_starts_later_and_ends_sooner(self) -> None:
        theirs = np.arange(10) * 0.5
        self.assertEqual(beat_list_ends(theirs[2:8], theirs),
                         'Our first beat is their beat index 2, our last is their 7.')

    def test_our_list_starts_earlier(self) -> None:
        # All Eyes on Us: the tool lists one beat before the manifest's first beat.
        ours = np.arange(10) * 0.5
        self.assertEqual(beat_list_ends(ours, ours[1:]), 'Their first beat is our beat index 1, our last is their 8.')

    def test_our_list_ends_later(self) -> None:
        ours = np.arange(10) * 0.5
        self.assertEqual(beat_list_ends(ours, ours[:7]), 'Our first beat is their beat index 0, their last is our 6.')

    def test_half_their_tempo(self) -> None:
        # Drum and Bass Violins: our beats are their beats of even index.
        theirs = np.arange(20) * 0.25
        self.assertEqual(beat_list_ends(theirs[::2], theirs),
                         'Our first beat is their beat index 0, our last is their 18.')


if __name__ == '__main__':
    unittest.main()
