"""Unit tests for how the song tool chooses the bar start: the clues and the choice, from given numbers.

Run them with `npm run test-songs`. They read no audio and start no browser.
"""

import unittest

import numpy as np

from add_song import (
    CHORDS_WEIGHT,
    DRUMS_WEIGHT,
    RISES_WEIGHT,
    BarClue,
    choose_bar_start,
    chords_clue,
    drums_clue,
    start_clue,
)


def rises(*beats: int) -> BarClue:
    """Returns a level-rises clue for the given beats, or an undecided one."""
    return BarClue('level rises', RISES_WEIGHT, beats, '')


def chords(*beats: int) -> BarClue:
    """Returns a chord clue for the given beat, or an undecided one."""
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
        self.assertIn('no backbeat', clue.detail)

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

    def test_rises_with_the_drums_are_certain(self) -> None:
        # Job, Hold On: the chords are undecided.
        choice = choose_bar_start([start_clue(), rises(0), chords(), drums(0, 2)])
        self.assertEqual(choice.first_downbeat, 0)
        self.assertEqual(choice.confidence, 'high')


if __name__ == '__main__':
    unittest.main()
