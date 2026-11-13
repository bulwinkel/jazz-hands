"""Adds a song to the game: analyses the audio, prints the evidence and writes the manifest.

Usage, from the repo root, after `npm run setup-songs`:

    npm run add-song -- "/path/to/Song Name.mp3" [--title "Song Name"] [--id song-name]
        [--first-downbeat N] [--pacing rank|level] [--short-start auto|none|SECONDS]
        [--half-beat keep|shift] [--beats BEATS.json]
        [--out-dir DIR] [--compare MANIFEST.json] [--keep-work]

The steps, in order:

  1. Decode the file with ffmpeg, and with headless Chrome as the game does. The two decoders
     can disagree about where the audio starts, so the offset between them is measured.
  2. Make three onset envelopes: all bands, percussive, and the kick band (30 to 150 Hz).
  3. Find the tempo, then test whether one tempo holds for the whole song. If it holds, fit
     one exact grid. If not, fit tempo and phase in short windows and join them. Where the
     kick is clear, also track the beats, and keep the tracked beats when they follow the
     kick more closely.
  4. Put the beats on the pulses that carry the kick and the chord changes, then move them
     onto the kick drum's onset.
  5. Find the first and last beat of the music, where the beat stops being clear, and the
     beat that starts the bars.
  6. Rate the energy of each bar, set the pace from it, and choose where the Short round starts.
  7. Write two click-check clips, the audio copy and the manifest.

Every step prints its evidence, so a reader can judge the result without running it again.
When the evidence shows that a step chose wrong, an option overrules that step alone:
--first-downbeat for the bar start, --half-beat for the choice between the beats and the
pulses between them, and --beats for the whole beat grid (steps 3 and 4, but for the move
onto the kick). The steps after it then run as usual.
All times are in ffmpeg's decode of the file until the manifest is built: only there does
the Chrome offset go on.

The audio file is untrusted input. Its path only ever travels as one program argument.

Exit code 0 means the manifest was written. Exit code 1 means the tool could not make a
manifest it would trust, and says why in one line.
"""

import argparse
import json
import math
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import librosa
import numpy as np
import soundfile
from scipy.interpolate import UnivariateSpline
from scipy.ndimage import median_filter
from scipy.signal import butter, sosfiltfilt

# --- Places ---

TOOL_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOL_DIR.parent.parent
SONGS_DIR = REPO_ROOT / 'public' / 'songs'
CLIPS_DIR = REPO_ROOT / 'test-results'
CHROME_DECODE_SCRIPT = TOOL_DIR / 'chrome_decode.mjs'
# Where the game serves the songs from. The manifest's `audio` field starts with this.
SONGS_URL = '/songs'

# --- Decoding ---

FFMPEG_TIMEOUT_SEC = 300
CHROME_TIMEOUT_SEC = 120
# The game's song test needs a Short round of more than this, so a song must last as long.
MIN_SONG_SEC = 60.0
# A file whose largest sample is below this (-80 dB) is silent.
SILENT_PEAK = 1e-4
# Landmarks compare the two decoders: the time of the largest sample in each of these 1 s
# windows. The largest value, not the largest magnitude: decoders scale the two ends of a
# clipped 16-bit sample differently, and would then pick different samples.
LANDMARK_COUNT = 16
# A window quieter than this has no clear largest sample.
LANDMARK_MIN_LEVEL = 0.02
# Landmarks whose offsets are this close agree with each other.
LANDMARK_TOLERANCE_SEC = 0.0005
# The offset is trusted when at least this many landmarks, and this share of them, agree.
LANDMARK_MIN_AGREEING = 4
LANDMARK_MIN_SHARE = 0.5
# The manifest ends this long before Chrome's decoded audio does. The game refuses a
# manifest that is longer than the audio by more than 0.1 s.
DURATION_MARGIN_SEC = 0.05

# --- Envelopes ---

# All analysis runs on a mono copy at this rate.
ANALYSIS_RATE = 22050
# Samples between envelope frames: 5.8 ms.
HOP = 128
FRAME_SEC = HOP / ANALYSIS_RATE
FFT_SIZE = 2048
# The kick drum. Both songs analysed by hand have a kick on every beat here.
KICK_BAND_HZ = (30.0, 150.0)

# --- Tempo ---

# Tempos scored for the report. The true beat shows as the sharpest peak.
TEMPO_SCORED_BPM = (55.0, 205.0)
TEMPO_STEP_BPM = 0.25
# The beat is chosen in this range. Double and half tempos fall outside it.
TEMPO_CHOICE_BPM = (70.0, 140.0)
# Tempo is scored in windows, so a song that drifts by a few percent still gives one peak.
TEMPO_WINDOW_SEC = 30.0
# A tempo's score is this percentile of its window scores: its clearest windows. The drums
# show the tempo best, and a soft song has them in a few sections only.
TEMPO_WINDOW_PERCENTILE = 90
# Phases tried for each comb in the tempo search.
COMB_PHASES = 32
# Peaks closer than this share of the tempo are one peak.
TEMPO_PEAK_SEPARATION = 0.03
# A comb score is the envelope on the comb's teeth over the envelope's mean.
# With a kick-band score below this, the song has no clear kick and all bands choose the tempo.
CLEAR_KICK_SCORE = 3.0
# Below this score the beat is weak. Below the next, there is no steady beat to find.
WEAK_BEAT_SCORE = 2.5
NO_BEAT_SCORE = 1.8
# Another tempo with this share of the best score makes the choice unclear.
RIVAL_TEMPO_SHARE = 0.8
# Above this tempo two beats are closer than the game's minimum cue interval of 0.55 s.
MIN_CUE_INTERVAL_SEC = 0.55

# --- Constant grid ---

# The best constant tempo is searched this far around the estimate, then refined.
GRID_COARSE_RANGE = 0.03
GRID_COARSE_STEP_BPM = 0.02
GRID_FINE_RANGE_BPM = 0.06
GRID_FINE_STEP_BPM = 0.002
GRID_PHASE_STEP_SEC = 0.002
# The tempo is constant when, in every block, the kick stays this close to its usual place
# on the grid.
BLOCK_SEC = 20.0
MAX_KICK_DRIFT_SEC = 0.015
# A block has a clear beat when its best phase scores this many times its median phase.
CLEAR_BLOCK_CONTRAST = 4.0
MIN_CLEAR_BLOCKS = 2

# --- Tracked beats ---

# How firmly the tracker holds the tempo. 300 follows a slow drift and ignores syncopation.
TRACKER_TIGHTNESS = 300
MIN_TRACKED_BEATS = 16
# The smoothing spline may leave this much RMS distance to the tracked beats.
SMOOTHING_SEC = 0.010
# A tracked beat further than this from the smooth curve is dropped, then the curve is refitted.
OUTLIER_SEC = 0.030
SMOOTHING_ROUNDS = 4
# Kept beats in a run shorter than this, between dropped beats, are dropped too:
# nothing next to them confirms them.
MIN_TRUSTED_RUN = 4
# The tracker reads the kick. It is tried when this share of the song's blocks has a clear kick,
# and dropped when less than this share of its beats stays on the smooth curve.
TRACKER_MIN_KICK_SHARE = 0.75
TRACKER_MIN_KEPT_SHARE = 0.9
# Tracked beats are used only when they stay this close to the window anchors' beats: the
# tracker may place a beat better, it may not slip to another pulse.
TRACKER_MAX_FROM_ANCHORS_SEC = 0.050
# Tracked beats and window anchors are compared by how the kick sits on them, in blocks this long.
KICK_COMPARE_SEC = 10.0
# The game's song test rejects a beat interval further than this from the median.
MAX_INTERVAL_DEVIATION = 0.05

# --- Window anchors ---

# Tempo and phase are fitted in windows of this length, this far apart.
ANCHOR_WINDOW_SEC = 12.0
ANCHOR_HOP_SEC = 2.0
# A window fitted alone may be this far from the song's tempo.
ANCHOR_FREE_RANGE_BPM = 2.5
ANCHOR_FREE_STEP_BPM = 0.05
# A window tied to its neighbour may differ from it by this much tempo and this much phase.
ANCHOR_TIED_RANGE_BPM = 0.5
ANCHOR_TIED_STEP_BPM = 0.02
ANCHOR_TIED_PHASE_SEC = 0.050
ANCHOR_PHASE_STEP_SEC = 0.003
# The smoothing spline may leave this much RMS distance to the anchors.
ANCHOR_SMOOTHING_SEC = 0.006
# A window's clarity is its best comb score over the median score of all phases: near 1 with
# no beat. A window holds the beat with this clarity.
BEAT_MIN_CLARITY = 2.0
# Where the song starts or ends with no beat, the windows next to that part are partly on the
# beat and score in between. The beat reaches as far as the windows with this share of the
# typical clarity.
BEAT_EDGE_SHARE_OF_TYPICAL = 0.5
MIN_HOLDING_WINDOWS = 4
# The beat list stops early when the music goes on this long after the last clear beat.
# A shorter stretch is the song's own ending.
BEATLESS_END_MIN_SEC = 8.0

# --- Kick alignment ---

# The kick's amplitude is read with this RMS window, at these offsets around each beat.
KICK_RMS_SEC = 0.006
KICK_PROFILE_MS = (-80, 100)
KICK_SECTION_SEC = 30.0
# A beat belongs this long before the kick reaches half height: on its onset.
BEAT_BEFORE_HALF_RISE_SEC = 0.005
# A section's kick is clear with this many beats, this rise from its lowest point to its
# peak, and this share of the strongest section's peak.
KICK_MIN_BEATS = 8
KICK_MIN_CONTRAST = 0.5
KICK_MIN_STRENGTH = 0.25
# A clear section whose kick is further than this from the beat gets a warning.
KICK_WARN_SEC = 0.015

# --- First and last beat ---

# Level is read in frames of this many samples: 10 ms.
LEVEL_FRAME = 220
LEVEL_FRAME_SEC = LEVEL_FRAME / ANALYSIS_RATE
# The song's loud level is this percentile of its 10 ms levels.
LOUD_PERCENTILE = 95
# Sound starts where the level first comes within this of the loud level.
SILENCE_BELOW_LOUD_DB = 50.0
# A beat still has music when its typical level is within this of the loud level.
# Below it is the ring-out of the last note.
RING_OUT_BELOW_LOUD_DB = 20.0
# A beat's onset strength is the largest envelope value in this window around it.
ONSET_WINDOW_SEC = (-0.05, 0.07)
# A beat with this share of the typical onset strength has a hit on it, so it has music
# even when the sound between the hits is near silence.
HIT_SHARE_OF_TYPICAL = 0.25
MIN_BEATS = 32

# --- Bars ---

BEATS_PER_BAR = 4
# A rise compares the level of this many beats before a beat with as many from it.
RISE_SPAN_BEATS = 4
RISE_COUNT = 10
RISE_SEPARATION_BEATS = 6
RISE_MIN_DB = 2.0
# A pickup or drum fill can make a rise show one beat early. Such a rise counts this much.
RISE_ONE_EARLY_WEIGHT = 0.5
# A clue points to a beat only when that beat scores this many times the next best.
RISE_DECISIVE_RATIO = 1.5
CHORD_DECISIVE_RATIO = 1.25
CHROMA_HOP = 512
# Chroma is read this far inside each beat, away from the note changes at its edges.
CHROMA_INSET_SEC = 0.04
# How much each clue counts when the bar start is chosen.
START_WEIGHT = 1.0
RISES_WEIGHT = 2.0
CHORDS_WEIGHT = 1.0
# The bar start is certain when the clues for it weigh this much and no clue is against it.
CERTAIN_WEIGHT = 3.0

# --- Intensity ---

LEVEL_SHARE = 0.6
DENSITY_SHARE = 0.4
INTENSITY_PERCENTILES = (5, 95)
INTENSITY_MEDIAN_BARS = 3
# The game's level rules change at these intensities (see LEVELS and CHART in config.ts):
# below the first a bar plays slow, below the second medium, from the second on full.
INTENSITY_STEPS = (0.35, 0.5)
# Rank pacing gives every song the same pace mix. The quietest bars, up to the first share,
# play slow. The bars up to the second share play medium. The rest play full.
RANK_PACING_SHARES = (0.12, 0.30)

# --- Short round ---

# The Short round lasts this long (TIMING.shortSec in config.ts), then ends on a bar start.
SHORT_ROUND_SEC = 90.0
# The game's song test accepts a Short round between these lengths.
SHORT_ROUND_LIMITS_SEC = (60.0, 95.0)
# The round may start on every bar start this many bars apart, counted from the first downbeat.
SHORT_START_EVERY_BARS = 4
# A later start is written only when its 90 s are this much more intense than the first 90 s.
SHORT_START_MIN_GAIN = 0.1

# --- Report and check clips ---

REPORT_SECTION_SEC = 30.0
# Tempo at the start, middle and end is the mean over this many beat intervals.
TEMPO_SPAN_BEATS = 20
CLIP_SEC = 25.0
CLIP_SONG_GAIN = 0.6
CLIP_TAIL_SEC = 1.5
CLICK_SEC = 0.03
CLICK_DECAY_SEC = 0.006
CLICK_GAIN = 0.5
CLICK_HZ = 880.0
BAR_CLICK_HZ = 1760.0


class SongError(Exception):
    """A problem the user can act on. `main` prints its message and exits 1, with no traceback."""


class Report:
    """Prints the evidence as the analysis runs, and keeps the warnings for the summary."""

    def __init__(self) -> None:
        """Starts with no warnings."""
        self.warnings: list[str] = []

    def section(self, title: str) -> None:
        """Starts a new section of the report."""
        print(f'\n{title}')

    def line(self, text: str) -> None:
        """Prints one line of evidence in the current section."""
        print(f'  {text}')

    def warn(self, text: str) -> None:
        """Prints a warning where it arises, and keeps it for the summary at the end."""
        self.warnings.append(text)
        print(f'  WARNING: {text}')


# --- The job: what to analyse and where the results go ---


@dataclass(frozen=True)
class Job:
    """One run of the tool, with every argument checked."""

    source: Path
    title: str
    song_id: str
    extension: str
    first_downbeat: int | None
    # 'keep' or 'shift' when the user overrules the half-beat step, else None.
    half_beat: str | None
    # Beat times in the file that replace the tool's own beat grid, or None.
    given_beats: np.ndarray | None
    given_beats_path: Path | None
    # 'rank' or 'level'.
    pacing: str
    # 'auto', 'none', or a time in seconds.
    short_start: str | float
    out_dir: Path
    reference: dict | None
    reference_path: Path | None
    keep_work: bool

    @property
    def audio_url(self) -> str:
        """The path the game loads the audio from: the manifest's `audio` field."""
        return f'{SONGS_URL}/{self.song_id}{self.extension}'

    @property
    def manifest_url(self) -> str:
        """The path the game loads the manifest from: what goes in SONGS."""
        return f'{SONGS_URL}/{self.song_id}.json'


def parse_arguments(argv: list[str]) -> argparse.Namespace:
    """Returns the command-line arguments. argparse prints the usage and exits on a bad one."""
    parser = argparse.ArgumentParser(
        prog='npm run add-song --',
        description='Analyse a song, print the evidence and write its manifest for the game.',
    )
    parser.add_argument('audio', type=Path, help='the audio file, for example an MP3 or M4A')
    parser.add_argument('--title', help='song title (default: the file name without its extension)')
    parser.add_argument('--id', help='song id (default: the title in lower case with hyphens)')
    parser.add_argument('--first-downbeat', type=int, metavar='N',
                        help='index of the first bar start, to overrule the tool')
    parser.add_argument('--half-beat', choices=['keep', 'shift'],
                        help='keep the beats where the grid put them, or move them by half a beat onto the '
                             'pulses between them, to overrule the tool')
    parser.add_argument('--beats', type=Path, metavar='BEATS.json',
                        help="use these beat times in place of the tool's own beat grid: a JSON list of "
                             'seconds in the audio file')
    parser.add_argument('--pacing', choices=['rank', 'level'], default='rank',
                        help='how intensity sets the pace: by the rank of each bar in the song (default), '
                             'or by its level alone')
    parser.add_argument('--short-start', default='auto', metavar='auto|none|SECONDS',
                        help='where the Short round starts: the best 90 s (default), the start of the song, '
                             'or the bar start nearest a time')
    parser.add_argument('--out-dir', type=Path, metavar='DIR',
                        help=f'write the manifest and the audio copy here, not in {SONGS_DIR.relative_to(REPO_ROOT)}')
    parser.add_argument('--compare', type=Path, metavar='MANIFEST.json',
                        help='print how the new beat times differ from this manifest')
    parser.add_argument('--keep-work', action='store_true', help='keep the intermediate files')
    return parser.parse_args(argv)


def slug(title: str) -> str:
    """Returns the title in lower case with hyphens: the default song id and file name."""
    ascii_title = unicodedata.normalize('NFKD', title).encode('ascii', 'ignore').decode('ascii')
    return re.sub(r'[^a-z0-9]+', '-', ascii_title.lower()).strip('-')


def read_reference(path: Path) -> dict:
    """Returns the manifest to compare with. Read before the analysis, so a bad path fails at once."""
    try:
        reference = json.loads(path.read_text(encoding='utf-8'))
        usable = (len(reference['beats']) >= 2 and len(reference['intensity']) == len(reference['beats'])
                  and reference['firstDownbeat'] >= 0 and reference['beatsPerBar'] >= 1)
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise SongError(f'Cannot read a song manifest from {path}: {error!r}') from error
    if not usable:
        raise SongError(f'{path} is not a song manifest the tool can compare with.')
    return reference


def read_beats(path: Path) -> np.ndarray:
    """Returns the beat times of --beats. Read before the analysis, so a bad file fails at once."""
    try:
        beats = np.array(json.loads(path.read_text(encoding='utf-8')), dtype=float)
    except (OSError, ValueError, TypeError) as error:
        raise SongError(f'Cannot read beat times from {path}: {error!r}') from error
    usable = (beats.ndim == 1 and len(beats) >= MIN_BEATS and bool(np.all(np.isfinite(beats)))
              and beats[0] >= 0 and bool(np.all(np.diff(beats) > 0)))
    if not usable:
        raise SongError(f'{path} must hold a JSON list of at least {MIN_BEATS} beat times in seconds, '
                        'each later than the one before.')
    return beats


def read_short_start(text: str) -> str | float:
    """Returns the --short-start choice: 'auto', 'none', or a time in seconds."""
    if text in ('auto', 'none'):
        return text
    try:
        seconds = float(text)
    except ValueError:
        seconds = math.nan
    if not seconds >= 0 or math.isinf(seconds):
        raise SongError('--short-start must be auto, none, or a time in seconds.')
    return seconds


def plan_job(arguments: argparse.Namespace) -> Job:
    """Returns the checked job. Raises SongError for a bad file, title, id or option."""
    source = arguments.audio.expanduser().resolve()
    if not source.is_file():
        raise SongError(f'There is no file at {source}')
    extension = source.suffix.lower()
    if not re.fullmatch(r'\.[a-z0-9]+', extension):
        raise SongError('The audio file needs an extension such as .mp3 or .m4a.')

    title = (arguments.title or source.stem).strip()
    if not title or any(unicodedata.category(char).startswith('C') for char in title):
        raise SongError('The title must be text, with no control characters. Give one with --title.')

    song_id = arguments.id if arguments.id is not None else slug(title)
    if not re.fullmatch(r'[a-z0-9]+(-[a-z0-9]+)*', song_id):
        raise SongError(f'The id "{song_id}" must be lower-case letters, digits and single hyphens. '
                        'Give one with --id.')

    if arguments.first_downbeat is not None and arguments.first_downbeat < 0:
        raise SongError('--first-downbeat must be 0 or more.')

    return Job(
        source=source,
        title=title,
        song_id=song_id,
        extension=extension,
        first_downbeat=arguments.first_downbeat,
        half_beat=arguments.half_beat,
        given_beats=read_beats(arguments.beats) if arguments.beats else None,
        given_beats_path=arguments.beats,
        pacing=arguments.pacing,
        short_start=read_short_start(arguments.short_start),
        out_dir=arguments.out_dir.expanduser().resolve() if arguments.out_dir else SONGS_DIR,
        reference=read_reference(arguments.compare) if arguments.compare else None,
        reference_path=arguments.compare,
        keep_work=arguments.keep_work,
    )


# --- Decoding ---


@dataclass(frozen=True)
class Audio:
    """The song as ffmpeg decodes it."""

    # Channel 0 at the file's own rate, to compare with Chrome's decode.
    native: np.ndarray
    native_rate: int
    channels: int
    # Mono at ANALYSIS_RATE. All analysis reads this.
    samples: np.ndarray

    @property
    def duration_sec(self) -> float:
        """Length of ffmpeg's decode. Chrome's can differ by the decode offset."""
        return len(self.native) / self.native_rate


@dataclass(frozen=True)
class ChromeDecode:
    """What Chrome made of the file, compared with ffmpeg's decode."""

    duration_sec: float
    # Chrome's time of a sound minus ffmpeg's time of it. Added to every beat time.
    offset_sec: float
    landmarks: int
    agreeing: int


def run_program(command: list[str], timeout_sec: float) -> subprocess.CompletedProcess[str]:
    """Runs a helper program with no shell and no input, and returns its result.

    Exists so every helper gets the same guards: an argument list, a time limit, and a clear
    error when the program is missing.
    """
    try:
        return subprocess.run(command, stdin=subprocess.DEVNULL, capture_output=True, text=True,
                              errors='replace', timeout=timeout_sec, check=False)
    except FileNotFoundError as error:
        raise SongError(f'The program "{command[0]}" is not installed, or not on PATH.') from error
    except subprocess.TimeoutExpired as error:
        raise SongError(f'"{command[0]}" did not finish in {timeout_sec:.0f} s.') from error


def first_line(text: str) -> str:
    """Returns the first non-empty line of a program's error output, as the reason it failed.

    ffmpeg starts its lines with a tag such as "[in#0 @ 0x9d2808000]". The tag is removed.
    """
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return re.sub(r'^\[[^\]]*\]\s*', '', lines[0]) if lines else 'It gave no reason.'


def decode_with_ffmpeg(source: Path, work_dir: Path) -> Path:
    """Decodes the first audio stream to a float WAV at the file's own rate. Returns its path.

    Float samples keep peaks above full scale, so both decoders see the same largest sample.
    ffmpeg may open local files only: a playlist posing as audio cannot make it fetch a URL.
    """
    decoded = work_dir / 'decoded.wav'
    result = run_program(
        ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file',
         '-i', str(source), '-map', '0:a:0', '-vn', '-sn', '-dn', '-c:a', 'pcm_f32le', '-f', 'wav',
         str(decoded)],
        FFMPEG_TIMEOUT_SEC,
    )
    if result.returncode != 0:
        raise SongError(f'ffmpeg cannot read "{source.name}" as audio. ffmpeg said: {first_line(result.stderr)}')
    return decoded


def load_audio(decoded: Path) -> Audio:
    """Returns the decoded song, with the mono copy for analysis. Raises SongError if unusable."""
    channels, native_rate = soundfile.read(decoded, dtype='float32', always_2d=True)
    duration_sec = len(channels) / native_rate
    if duration_sec < MIN_SONG_SEC:
        raise SongError(f'The audio is {duration_sec:.1f} s long. A song needs at least {MIN_SONG_SEC:.0f} s.')
    if not np.isfinite(channels).all():
        raise SongError('The decoded audio has samples that are not numbers.')
    if np.abs(channels).max() < SILENT_PEAK:
        raise SongError('The audio is silent.')

    mono = channels.mean(axis=1)
    samples = librosa.resample(mono, orig_sr=native_rate, target_sr=ANALYSIS_RATE)
    return Audio(native=channels[:, 0].copy(), native_rate=native_rate, channels=channels.shape[1],
                 samples=samples)


def landmark_window_starts(duration_sec: float) -> list[int]:
    """Returns the whole-second starts of the 1 s landmark windows, spread over the song.

    Whole seconds make the window's first sample the same exact index for both decoders.
    """
    starts = np.linspace(0.05 * duration_sec, 0.95 * duration_sec - 1, LANDMARK_COUNT)
    return sorted({int(start) for start in starts})


def ffmpeg_landmarks(audio: Audio, window_starts: list[int]) -> tuple[np.ndarray, np.ndarray]:
    """Returns the time and the level of the largest sample in each window of ffmpeg's decode."""
    times = []
    levels = []
    for start in window_starts:
        first = start * audio.native_rate
        window = audio.native[first:first + audio.native_rate]
        peak = int(np.argmax(window))
        times.append((first + peak) / audio.native_rate)
        levels.append(float(window[peak]))
    return np.array(times), np.array(levels)


def agreed_offset(differences: np.ndarray) -> tuple[float, int]:
    """Returns the offset that most landmarks agree on, and how many agree on it.

    A window with two equal peaks can give the decoders different landmarks. Such a pair is
    far from the rest, so the largest group of close offsets sets the answer, not the median.
    """
    close = np.abs(differences[:, None] - differences[None, :]) <= LANDMARK_TOLERANCE_SEC
    centre = int(close.sum(axis=1).argmax())
    group = differences[close[centre]]
    return float(np.median(group)), len(group)


def decode_with_chrome(source: Path, audio: Audio) -> ChromeDecode:
    """Decodes the file in headless Chrome and measures where its audio sits against ffmpeg's.

    The game plays Chrome's decode, and the analysis reads ffmpeg's. For an MP3 the two agree.
    For Opus in an MP4 container Chrome is 6.5 ms earlier. So the offset is measured, not assumed.
    """
    window_starts = landmark_window_starts(audio.duration_sec)
    result = run_program(
        ['node', str(CHROME_DECODE_SCRIPT), str(source), f'--rate={audio.native_rate}',
         f'--windows={",".join(str(start) for start in window_starts)}'],
        CHROME_TIMEOUT_SEC,
    )
    if result.returncode != 0:
        raise SongError(first_line(result.stderr).removeprefix('chrome_decode: '))
    try:
        chrome = json.loads(result.stdout)
    except ValueError as error:
        raise SongError(f'{CHROME_DECODE_SCRIPT.name} did not print JSON: {first_line(result.stdout)}') from error
    if chrome['sampleRate'] != audio.native_rate:
        raise SongError(f'Chrome decoded at {chrome["sampleRate"]} Hz, not at {audio.native_rate} Hz.')

    ffmpeg_times, ffmpeg_levels = ffmpeg_landmarks(audio, window_starts)
    chrome_times = np.array([landmark['peakSec'] for landmark in chrome['landmarks']])
    chrome_levels = np.array([landmark['peakLevel'] for landmark in chrome['landmarks']])
    loud = (ffmpeg_levels >= LANDMARK_MIN_LEVEL) & (chrome_levels >= LANDMARK_MIN_LEVEL)
    differences = (chrome_times - ffmpeg_times)[loud]
    if len(differences) < LANDMARK_MIN_AGREEING:
        raise SongError('The audio is too quiet to compare the Chrome and ffmpeg decodes.')

    offset_sec, agreeing = agreed_offset(differences)
    if agreeing < max(LANDMARK_MIN_AGREEING, LANDMARK_MIN_SHARE * len(differences)):
        raise SongError(
            f'Chrome and ffmpeg decode this file differently, and not by one offset: only {agreeing} of '
            f'{len(differences)} landmarks agree. Beat times from ffmpeg would be wrong in the game.')
    return ChromeDecode(duration_sec=float(chrome['durationSec']), offset_sec=offset_sec,
                        landmarks=len(differences), agreeing=agreeing)


def report_decode(report: Report, audio: Audio, chrome: ChromeDecode) -> None:
    """Prints what each decoder made of the file, and the offset between them."""
    report.section('Decode')
    report.line(f'ffmpeg: {audio.duration_sec:.3f} s, {audio.native_rate} Hz, {audio.channels} channel(s)')
    report.line(f'Chrome: {chrome.duration_sec:.3f} s')
    report.line(f'Chrome decode offset: {chrome.offset_sec * 1000:+.2f} ms '
                f'({chrome.agreeing} of {chrome.landmarks} landmarks agree). It goes on every beat time.')


# --- Envelopes ---


@dataclass(frozen=True)
class Envelopes:
    """Onset envelopes on one frame clock, HOP samples apart. Each has a mean of 1."""

    full: np.ndarray
    percussive: np.ndarray
    kick: np.ndarray

    def stack(self) -> np.ndarray:
        """Returns the three envelopes as rows, so one comb can score all of them."""
        return np.stack([self.full, self.percussive, self.kick])


def kick_band_flux(samples: np.ndarray) -> np.ndarray:
    """Returns the rise of log energy in the kick band, frame by frame: high where a kick starts."""
    spectrum = np.abs(librosa.stft(samples, n_fft=FFT_SIZE, hop_length=HOP))
    frequencies = librosa.fft_frequencies(sr=ANALYSIS_RATE, n_fft=FFT_SIZE)
    in_band = (frequencies >= KICK_BAND_HZ[0]) & (frequencies <= KICK_BAND_HZ[1])
    log_energy = np.log1p(spectrum[in_band].sum(axis=0))
    return np.maximum(0, np.diff(log_energy, prepend=log_energy[0]))


def onset_envelopes(samples: np.ndarray, percussive: np.ndarray) -> Envelopes:
    """Returns the three onset envelopes the beat search reads. `percussive` is the drum part."""
    raw = [
        librosa.onset.onset_strength(y=samples, sr=ANALYSIS_RATE, hop_length=HOP),
        librosa.onset.onset_strength(y=percussive, sr=ANALYSIS_RATE, hop_length=HOP),
        kick_band_flux(samples),
    ]
    frames = min(len(envelope) for envelope in raw)
    full, percussive_envelope, kick = (
        envelope[:frames] / max(float(envelope[:frames].mean()), 1e-9) for envelope in raw
    )
    return Envelopes(full=full, percussive=percussive_envelope, kick=kick)


def sample_at(envelopes: np.ndarray, times: np.ndarray) -> np.ndarray:
    """Returns the envelope values at `times`, by linear interpolation between frames.

    Frames are on the last axis of `envelopes`, so one call can read several envelopes.
    """
    last_frame = envelopes.shape[-1] - 1
    position = np.clip(times / FRAME_SEC, 0, last_frame)
    lower = np.minimum(position.astype(int), last_frame - 1)
    weight = position - lower
    return envelopes[..., lower] * (1 - weight) + envelopes[..., lower + 1] * weight


def comb_scores(envelopes: np.ndarray, period_sec: float, start_sec: float, end_sec: float,
                phases_sec: np.ndarray) -> np.ndarray:
    """Returns the mean envelope value on a comb of evenly spaced times, for each phase.

    A comb has one tooth per `period_sec`, the first at `start_sec` plus the phase. A comb whose
    teeth sit on the beats scores high: this is how tempo and phase are found. Phases must be
    below one period. The last axis of the result is the phase.
    """
    teeth = max(1, int((end_sec - start_sec) / period_sec) - 1)
    times = start_sec + phases_sec[:, None] + period_sec * np.arange(teeth)
    return sample_at(envelopes, times).mean(axis=-1)


# --- Tempo ---


@dataclass(frozen=True)
class TempoEstimate:
    """The tempo of the beat, to about a quarter BPM, and how clear it is."""

    bpm: float
    score: float
    # True when the kick band chose the tempo, False when all bands had to.
    from_kick: bool
    # Another tempo that fits almost as well, as (bpm, score), or None.
    rival: tuple[float, float] | None
    # The strongest tempos of the kick band and of all bands, as (bpm, score), for the report.
    kick_peaks: list[tuple[float, float]]
    joint_peaks: list[tuple[float, float]]


def windowed_tempo_scores(envelopes: np.ndarray, duration_sec: float) -> tuple[np.ndarray, np.ndarray]:
    """Returns the tempos scored and, for each envelope and tempo, the score of its clearest windows.

    Each window of the song scores a tempo by its best-phase comb. One comb over the whole song
    would smear a tempo that drifts. The clearest windows count, not the typical one: where
    only soft percussion plays, a comb at two thirds of the tempo scores as well as the beat.
    """
    bpms = np.arange(TEMPO_SCORED_BPM[0], TEMPO_SCORED_BPM[1] + TEMPO_STEP_BPM / 2, TEMPO_STEP_BPM)
    window_starts = np.arange(0, duration_sec - TEMPO_WINDOW_SEC, TEMPO_WINDOW_SEC / 2)
    scores = np.empty((len(window_starts), len(envelopes), len(bpms)))
    for window, start_sec in enumerate(window_starts):
        for column, bpm in enumerate(bpms):
            period_sec = 60 / bpm
            phases_sec = np.arange(COMB_PHASES) * period_sec / COMB_PHASES
            by_phase = comb_scores(envelopes, period_sec, start_sec, start_sec + TEMPO_WINDOW_SEC, phases_sec)
            scores[window, :, column] = by_phase.max(axis=-1)
    return bpms, np.percentile(scores, TEMPO_WINDOW_PERCENTILE, axis=0)


def strongest_tempos(bpms: np.ndarray, scores: np.ndarray, count: int) -> list[tuple[float, float]]:
    """Returns up to `count` peaks as (bpm, score), best first, no two closer than the separation."""
    peaks: list[tuple[float, float]] = []
    for index in np.argsort(scores)[::-1]:
        bpm = float(bpms[index])
        if all(abs(bpm - other) / other > TEMPO_PEAK_SEPARATION for other, _ in peaks):
            peaks.append((bpm, float(scores[index])))
        if len(peaks) == count:
            break
    return peaks


def estimate_tempo(envelopes: Envelopes, duration_sec: float) -> TempoEstimate:
    """Returns the beat tempo, to about a quarter BPM, with the evidence for it.

    The kick band chooses, because a kick on every beat gives the cleanest peak. Half and double
    tempo score well too, so the choice stays inside TEMPO_CHOICE_BPM. A song with no clear
    kick falls back to the mean score of all three envelopes.
    """
    bpms, scores = windowed_tempo_scores(envelopes.stack(), duration_sec)
    kick_scores = scores[2]
    joint_scores = scores.mean(axis=0)
    in_range = (bpms >= TEMPO_CHOICE_BPM[0]) & (bpms <= TEMPO_CHOICE_BPM[1])

    from_kick = float(kick_scores[in_range].max()) >= CLEAR_KICK_SCORE
    choosing = kick_scores if from_kick else joint_scores
    best, second = strongest_tempos(bpms[in_range], choosing[in_range], 2)
    return TempoEstimate(
        bpm=best[0],
        score=best[1],
        from_kick=from_kick,
        rival=second if second[1] >= RIVAL_TEMPO_SHARE * best[1] else None,
        kick_peaks=strongest_tempos(bpms, kick_scores, 5),
        joint_peaks=strongest_tempos(bpms, joint_scores, 5),
    )


def report_tempo(report: Report, tempo: TempoEstimate) -> None:
    """Prints the tempo evidence. Raises SongError when the song has no steady beat to find."""
    def listed(peaks: list[tuple[float, float]]) -> str:
        """Returns the peaks as text, best first."""
        return '   '.join(f'{bpm:.1f}: {score:.1f}' for bpm, score in peaks)

    report.section('Tempo')
    report.line('Score of a comb of evenly spaced beats, by tempo, in the clearest parts of the song. '
                '1.0 means no beat at that tempo.')
    report.line(f'kick band (BPM: score)   {listed(tempo.kick_peaks)}')
    report.line(f'all bands (BPM: score)   {listed(tempo.joint_peaks)}')
    chooser = 'the kick band' if tempo.from_kick else 'all bands'
    report.line(f'Chosen: about {tempo.bpm:.1f} BPM, the best peak of {chooser} from '
                f'{TEMPO_CHOICE_BPM[0]:.0f} to {TEMPO_CHOICE_BPM[1]:.0f} BPM (score {tempo.score:.1f}).')

    if tempo.score < NO_BEAT_SCORE:
        raise SongError(f'No steady beat found: the best tempo scores {tempo.score:.2f}, and a song '
                        f'with a beat scores {WEAK_BEAT_SCORE} or more.')
    if not tempo.from_kick:
        report.warn('The song has no clear kick drum. The tempo comes from all bands and is less certain.')
    if tempo.score < WEAK_BEAT_SCORE:
        report.warn(f'The beat is weak (score {tempo.score:.1f}). Check the click clips with care.')
    if tempo.rival:
        report.warn(f'The tempo is unclear: {tempo.rival[0]:.1f} BPM fits almost as well '
                    f'(score {tempo.rival[1]:.1f} against {tempo.score:.1f}).')


# --- Constant grid ---


@dataclass(frozen=True)
class ConstantGrid:
    """Beats at one tempo for the whole song."""

    bpm: float
    # Time of the grid's first beat at or after 0.
    phase_sec: float

    @property
    def period_sec(self) -> float:
        """Time from one beat to the next."""
        return 60 / self.bpm


@dataclass(frozen=True)
class BlockPhase:
    """Where the kick sits against a constant grid in one block of the song."""

    start_sec: float
    end_sec: float
    # Kick position minus grid beat. Near 0 in every block when the tempo is constant.
    offset_sec: float
    # Best phase score over median phase score. High when the block has a clear beat.
    contrast: float

    @property
    def clear(self) -> bool:
        """True when the block has a beat clear enough to place."""
        return self.contrast >= CLEAR_BLOCK_CONTRAST


def best_grid(envelopes: np.ndarray, duration_sec: float, bpms: np.ndarray,
              phase_step_sec: float | None) -> ConstantGrid:
    """Returns the tempo and phase, among those given, whose comb scores highest on the whole song.

    The score is the mean over the envelopes. With no phase step, each tempo tries COMB_PHASES.
    """
    best_score = -np.inf
    best = ConstantGrid(bpm=float(bpms[0]), phase_sec=0.0)
    for bpm in bpms:
        period_sec = 60 / bpm
        step_sec = phase_step_sec or period_sec / COMB_PHASES
        phases_sec = np.arange(0, period_sec, step_sec)
        by_phase = comb_scores(envelopes, period_sec, 0.0, duration_sec, phases_sec).mean(axis=0)
        if by_phase.max() > best_score:
            best_score = float(by_phase.max())
            best = ConstantGrid(bpm=float(bpm), phase_sec=float(phases_sec[by_phase.argmax()]))
    return best


def fit_constant_grid(envelopes: Envelopes, duration_sec: float, about_bpm: float) -> ConstantGrid:
    """Returns the best constant grid near `about_bpm`, to 0.002 BPM and 2 ms.

    Over a few hundred beats 0.01 BPM is tens of milliseconds, so the fine search matters.
    """
    stack = envelopes.stack()
    coarse_bpms = np.arange(about_bpm * (1 - GRID_COARSE_RANGE), about_bpm * (1 + GRID_COARSE_RANGE),
                            GRID_COARSE_STEP_BPM)
    coarse = best_grid(stack, duration_sec, coarse_bpms, phase_step_sec=None)
    fine_bpms = np.arange(coarse.bpm - GRID_FINE_RANGE_BPM, coarse.bpm + GRID_FINE_RANGE_BPM,
                          GRID_FINE_STEP_BPM)
    return best_grid(stack, duration_sec, fine_bpms, phase_step_sec=GRID_PHASE_STEP_SEC)


def grid_beats(grid: ConstantGrid, end_sec: float) -> np.ndarray:
    """Returns the grid's beat times from its first beat to before `end_sec`."""
    return grid.phase_sec + grid.period_sec * np.arange(math.ceil((end_sec - grid.phase_sec) / grid.period_sec))


def kick_phase_by_block(kick: np.ndarray, grid: ConstantGrid, duration_sec: float) -> list[BlockPhase]:
    """Returns, for each block of the song, where the kick sits against the constant grid.

    This is the test for a constant tempo: a grid at the wrong tempo slides away from the kick.
    """
    steps = int(grid.period_sec / 2 / GRID_PHASE_STEP_SEC)
    offsets_sec = GRID_PHASE_STEP_SEC * np.arange(-steps, steps + 1)
    beats = grid_beats(grid, duration_sec)

    blocks = []
    for start_sec in np.arange(0, duration_sec - BLOCK_SEC / 2, BLOCK_SEC):
        end_sec = min(start_sec + BLOCK_SEC, duration_sec)
        block_beats = beats[(beats >= start_sec) & (beats < end_sec)]
        by_offset = sample_at(kick, block_beats + offsets_sec[:, None]).mean(axis=-1)
        blocks.append(BlockPhase(
            start_sec=float(start_sec),
            end_sec=float(end_sec),
            offset_sec=float(offsets_sec[by_offset.argmax()]),
            contrast=float(by_offset.max() / max(float(np.median(by_offset)), 1e-9)),
        ))
    return blocks


def kick_drift_sec(blocks: list[BlockPhase]) -> float | None:
    """Returns how far the kick moves from its usual place on the grid, over the clear blocks.

    The usual place is the median offset: the kick envelope may lead or lag the other envelopes
    by a fixed amount, and only a change over time means the tempo changes. Returns None when
    too few blocks have a clear beat to tell.
    """
    clear_offsets = np.array([block.offset_sec for block in blocks if block.clear])
    if len(clear_offsets) < MIN_CLEAR_BLOCKS:
        return None
    return float(np.abs(clear_offsets - np.median(clear_offsets)).max())


def report_grid_test(report: Report, grid: ConstantGrid, blocks: list[BlockPhase], drift_sec: float | None) -> None:
    """Prints the constant-tempo test: where the kick sits against one grid, block by block."""
    report.section('Beat grid')
    report.line(f'Best constant tempo: {grid.bpm:.3f} BPM. Kick against that grid, per {BLOCK_SEC:.0f} s:')
    for block in blocks:
        offset = f'{block.offset_sec * 1000:+5.0f} ms' if block.clear else 'no clear kick'
        report.line(f'  {block.start_sec:4.0f} to {block.end_sec:4.0f} s   {offset}')

    limit_ms = MAX_KICK_DRIFT_SEC * 1000
    if drift_sec is None:
        report.line('Too few blocks have a clear kick to show a constant tempo.')
    elif drift_sec <= MAX_KICK_DRIFT_SEC:
        report.line(f'The kick stays within {drift_sec * 1000:.0f} ms of its usual place (limit {limit_ms:.0f} ms): '
                    'the tempo is constant.')
    else:
        report.line(f'The kick moves up to {drift_sec * 1000:.0f} ms from its usual place (limit {limit_ms:.0f} ms): '
                    'the tempo is not constant.')


# --- Tracked beats ---


@dataclass(frozen=True)
class SmoothedBeats:
    """Tracked beats after smoothing."""

    # One time per tracked beat, on the smooth curve.
    times: np.ndarray
    # False for tracked beats that were too far from the curve to shape it.
    kept: np.ndarray
    residual_rms_sec: float


def peak_scaled(envelope: np.ndarray) -> np.ndarray:
    """Returns the envelope scaled to a peak of 1. An envelope with no content stays at 0."""
    return envelope / max(float(envelope.max()), 1e-9)


def track_beats(envelopes: Envelopes, prior_bpm: float) -> np.ndarray:
    """Returns beat times from librosa's dynamic-programming tracker, for a tempo that drifts.

    The tracker reads the kick and the drums together, and stays near `prior_bpm`.
    Its times jitter by a frame or two, and it can misplace beats where the music is thin.
    """
    onsets = peak_scaled(envelopes.kick) + peak_scaled(envelopes.percussive)
    _, times = librosa.beat.beat_track(onset_envelope=onsets, sr=ANALYSIS_RATE, hop_length=HOP,
                                       bpm=prior_bpm, tightness=TRACKER_TIGHTNESS, trim=False, units='time')
    if len(times) < MIN_TRACKED_BEATS:
        raise SongError(f'The beat tracker found only {len(times)} beats.')
    return np.asarray(times, dtype=float)


def runs_of_true(mask: np.ndarray) -> list[tuple[int, int]]:
    """Returns the (start, stop) index pairs of each run of True in `mask`."""
    edges = np.flatnonzero(np.diff(np.concatenate(([0], mask.astype(int), [0]))))
    return list(zip(edges[::2].tolist(), edges[1::2].tolist()))


def drop_short_runs(kept: np.ndarray) -> np.ndarray:
    """Returns `kept` without its runs shorter than MIN_TRUSTED_RUN.

    A lone kept beat between dropped ones can bend the curve towards a misplaced beat:
    without this, the first seconds of a quiet intro flip between two answers.
    """
    trusted = kept.copy()
    for start, stop in runs_of_true(kept):
        if stop - start < MIN_TRUSTED_RUN:
            trusted[start:stop] = False
    return trusted


def smooth_beats(tracked: np.ndarray) -> SmoothedBeats:
    """Returns the tracked beats moved onto a smooth curve of time against beat index.

    A cubic smoothing spline removes the tracker's jitter and keeps the slow drift. Beats far
    from the curve are dropped and the curve is fitted again, a few rounds. Outside the kept
    beats the curve continues at a constant tempo: a cubic would bend away. When fewer than
    TRACKER_MIN_KEPT_SHARE of the beats stay, the rounds stop: the caller does not use such a curve.
    """
    indices = np.arange(len(tracked), dtype=float)

    def fit(kept: np.ndarray) -> UnivariateSpline:
        """Returns the smooth curve through the kept beats."""
        return UnivariateSpline(indices[kept], tracked[kept], k=3, s=kept.sum() * SMOOTHING_SEC ** 2)

    def rms_distance(times: np.ndarray, kept: np.ndarray) -> float:
        """Returns the RMS distance of the kept tracked beats from the curve."""
        return float(np.sqrt(((tracked - times)[kept] ** 2).mean()))

    kept = np.ones(len(tracked), dtype=bool)
    spline = fit(kept)
    for _ in range(SMOOTHING_ROUNDS):
        close = drop_short_runs(np.abs(tracked - spline(indices)) < OUTLIER_SEC)
        if close.mean() < TRACKER_MIN_KEPT_SHARE:
            times = spline(indices)
            return SmoothedBeats(times=times, kept=close, residual_rms_sec=rms_distance(times, kept))
        kept = close
        spline = fit(kept)

    first, last = np.flatnonzero(kept)[[0, -1]]
    interval = spline.derivative()
    times = spline(indices)
    times[:first] = spline(first) + (indices[:first] - first) * interval(first)
    times[last + 1:] = spline(last) + (indices[last + 1:] - last) * interval(last)
    return SmoothedBeats(times=times, kept=kept, residual_rms_sec=rms_distance(times, kept))


def extend_beats(beats: np.ndarray, end_sec: float) -> np.ndarray:
    """Returns the beats continued at their first and last interval, to cover 0 to `end_sec`.

    The tracker can start a beat late or stop a beat early. The music's first and last beat
    are chosen later from the sound, so the beats must reach both ends of the file first.
    """
    first_interval = beats[1] - beats[0]
    last_interval = beats[-1] - beats[-2]
    before = beats[0] - first_interval * np.arange(max(0, int(beats[0] / first_interval)), 0, -1)
    after = beats[-1] + last_interval * np.arange(1, max(1, math.ceil((end_sec - beats[-1]) / last_interval)))
    covering = np.concatenate((before, beats, after))
    return covering[(covering >= 0) & (covering < end_sec)]


def report_tracking(report: Report, tracked: np.ndarray, smoothed: SmoothedBeats) -> None:
    """Prints how many tracked beats shaped the smooth curve, and which were dropped."""
    dropped = np.flatnonzero(~smoothed.kept)
    report.line(f'Beat tracker: {len(tracked)} beats. {int(smoothed.kept.sum())} lie on one smooth tempo curve, '
                f'{smoothed.residual_rms_sec * 1000:.1f} ms RMS from it.')
    if 0 < len(dropped) <= 20:
        report.line(f'Tracked beats dropped as misplaced, by index: {" ".join(str(index) for index in dropped)}')


# --- Window anchors ---


@dataclass(frozen=True)
class WindowFit:
    """The best comb in one window of the song: a local tempo and one beat time."""

    centre_sec: float
    bpm: float
    # Time of one beat near the window's centre.
    anchor_sec: float
    # Mean envelope value on the comb's teeth. High where the drums are loud.
    score: float
    # The score over the median score of all phases at this tempo.
    clarity: float


@dataclass(frozen=True)
class AnchorGrid:
    """Beats made from the window fits, covering the whole file."""

    beats: np.ndarray
    # How clear the beat is in each window, in time order.
    clarity: np.ndarray
    # The curve runs through the windows between these times: the first and the last that hold
    # a clear beat. Outside them the beats continue at the curve's tempo.
    fitted_from_sec: float
    fitted_to_sec: float
    # Largest distance from a whole number in the beat counts between neighbouring windows.
    worst_count_error: float
    residual_rms_sec: float


def window_comb(envelope: np.ndarray, centre_sec: float, bpm: float, anchors_sec: np.ndarray) -> np.ndarray:
    """Returns the mean envelope value on a comb through each candidate anchor, inside one window."""
    period_sec = 60 / bpm
    start_sec = centre_sec - ANCHOR_WINDOW_SEC / 2
    first_tooth = anchors_sec - np.floor((anchors_sec - start_sec) / period_sec) * period_sec
    times = first_tooth[:, None] + period_sec * np.arange(int(ANCHOR_WINDOW_SEC / period_sec) + 1)
    inside = times < start_sec + ANCHOR_WINDOW_SEC
    return (sample_at(envelope, times) * inside).sum(axis=1) / inside.sum(axis=1)


def window_centres(duration_sec: float) -> np.ndarray:
    """Returns the centre time of each window of the song."""
    return np.arange(ANCHOR_WINDOW_SEC / 2, duration_sec - ANCHOR_WINDOW_SEC / 2 + 1e-9, ANCHOR_HOP_SEC)


def phase_scores(envelope: np.ndarray, centre_sec: float, bpm: float, first_anchor_sec: float) -> np.ndarray:
    """Returns the comb score in one window for every phase of one tempo.

    The first score belongs to the comb through `first_anchor_sec`. A score well above the
    median of the others is a clear beat. With no beat at this tempo, all phases score alike.
    """
    every_phase = first_anchor_sec + np.arange(0, 60 / bpm, ANCHOR_PHASE_STEP_SEC)
    return window_comb(envelope, centre_sec, bpm, every_phase)


def best_window_fit(envelope: np.ndarray, centre_sec: float, bpms: np.ndarray,
                    anchors_at: np.ndarray) -> WindowFit:
    """Returns the tempo and anchor, among the candidates, whose comb scores highest in the window.

    `anchors_at` holds the candidate anchor times. They are the same for every tempo.
    """
    best_score, best_bpm, best_anchor = -np.inf, float(bpms[0]), float(anchors_at[0])
    for bpm in bpms:
        scores = window_comb(envelope, centre_sec, bpm, anchors_at)
        top = int(scores.argmax())
        if scores[top] > best_score:
            best_score, best_bpm, best_anchor = float(scores[top]), float(bpm), float(anchors_at[top])

    by_phase = phase_scores(envelope, centre_sec, best_bpm, best_anchor)
    return WindowFit(centre_sec=centre_sec, bpm=best_bpm, anchor_sec=best_anchor, score=float(by_phase[0]),
                     clarity=float(by_phase[0] / max(float(np.median(by_phase)), 1e-9)))


def fit_free_window(envelope: np.ndarray, centre_sec: float, about_bpm: float) -> WindowFit:
    """Returns the best fit of one window on its own, with any phase, near the song's tempo."""
    bpms = np.arange(about_bpm - ANCHOR_FREE_RANGE_BPM, about_bpm + ANCHOR_FREE_RANGE_BPM + ANCHOR_FREE_STEP_BPM / 2,
                     ANCHOR_FREE_STEP_BPM)
    longest_period_sec = 60 / bpms[0]
    anchors_at = centre_sec + np.arange(-longest_period_sec / 2, longest_period_sec / 2, ANCHOR_PHASE_STEP_SEC)
    return best_window_fit(envelope, centre_sec, bpms, anchors_at)


def fit_tied_window(envelope: np.ndarray, centre_sec: float, neighbour: WindowFit) -> WindowFit:
    """Returns the best fit of one window that continues its neighbour's beats.

    The neighbour's beats, carried on at its tempo, predict a beat near this window's centre.
    The fit may move a little from that beat and that tempo, never by half a beat. A window
    with no beat gives the fit nothing to hold on to, and a run of them would walk away from
    the beat. Such a window keeps the neighbour's tempo and the predicted beat as they are.
    """
    period_sec = 60 / neighbour.bpm
    predicted_sec = neighbour.anchor_sec + round((centre_sec - neighbour.anchor_sec) / period_sec) * period_sec
    bpms = np.arange(neighbour.bpm - ANCHOR_TIED_RANGE_BPM,
                     neighbour.bpm + ANCHOR_TIED_RANGE_BPM + ANCHOR_TIED_STEP_BPM / 2, ANCHOR_TIED_STEP_BPM)
    anchors_at = predicted_sec + np.arange(-ANCHOR_TIED_PHASE_SEC, ANCHOR_TIED_PHASE_SEC + ANCHOR_PHASE_STEP_SEC / 2,
                                           ANCHOR_PHASE_STEP_SEC)
    fit = best_window_fit(envelope, centre_sec, bpms, anchors_at)
    if fit.clarity >= BEAT_MIN_CLARITY:
        return fit
    return WindowFit(centre_sec=centre_sec, bpm=neighbour.bpm, anchor_sec=predicted_sec, score=fit.score,
                     clarity=fit.clarity)


def fit_windows(envelope: np.ndarray, duration_sec: float, about_bpm: float) -> list[WindowFit]:
    """Returns the tempo and one beat time for each window of the song, in time order.

    A window on its own can lock onto the pulses between the beats. So the window with the
    strongest beat is fitted alone, and the fit walks outwards from it, each window tied to
    the one before. This follows soft percussion where the beat tracker loses the beat.
    """
    centres = window_centres(duration_sec)
    alone = [fit_free_window(envelope, float(centre), about_bpm) for centre in centres]
    start = int(np.argmax([fit.score for fit in alone]))

    fits = {start: alone[start]}
    for step in (1, -1):
        index = start + step
        while 0 <= index < len(centres):
            fits[index] = fit_tied_window(envelope, float(centres[index]), fits[index - step])
            index += step
    return [fits[index] for index in range(len(centres))]


def holds_beat(clarity: np.ndarray) -> np.ndarray:
    """Returns True for each window that holds a clear beat, given the clarity of every window in time order.

    A window with a clarity of BEAT_MIN_CLARITY holds the beat. Where the song starts or ends
    with no beat, the windows next to that part cover it in part: they are counted out too,
    up to the first that is as clear as BEAT_EDGE_SHARE_OF_TYPICAL of the typical window.
    """
    holding = clarity >= BEAT_MIN_CLARITY
    fully_on_beat = np.flatnonzero(holding & (clarity >= BEAT_EDGE_SHARE_OF_TYPICAL * np.median(clarity)))
    if len(fully_on_beat) and not holding[0]:
        holding[:fully_on_beat[0]] = False
    if len(fully_on_beat) and not holding[-1]:
        holding[fully_on_beat[-1] + 1:] = False
    return holding


def join_windows(fits: list[WindowFit], duration_sec: float) -> AnchorGrid:
    """Returns one smooth beat sequence through the windows, from the first to the last that holds the beat.

    The beats between neighbouring anchors are counted, which gives each anchor a beat index.
    A smoothing spline of anchor time against beat index is the tempo curve. Beyond its ends
    the beats continue at the curve's own tempo there, so the spacing has no kink.
    """
    clarity = np.array([fit.clarity for fit in fits])
    holding = holds_beat(clarity)
    if holding.sum() < MIN_HOLDING_WINDOWS:
        raise SongError('Too little of the song has a clear beat to place the beats.')
    first, last = np.flatnonzero(holding)[[0, -1]]
    anchors_sec = np.array([fit.anchor_sec for fit in fits[first:last + 1]])
    periods_sec = np.array([60 / fit.bpm for fit in fits[first:last + 1]])

    beats_apart = np.diff(anchors_sec) / ((periods_sec[:-1] + periods_sec[1:]) / 2)
    index = np.concatenate(([0], np.cumsum(np.round(beats_apart))))
    curve = UnivariateSpline(index, anchors_sec, k=3, s=len(index) * ANCHOR_SMOOTHING_SEC ** 2)
    residuals = anchors_sec - curve(index)
    return AnchorGrid(
        beats=extend_beats(curve(np.arange(index[-1] + 1)), duration_sec),
        clarity=clarity,
        fitted_from_sec=fits[first].centre_sec,
        fitted_to_sec=fits[last].centre_sec,
        worst_count_error=float(np.abs(beats_apart - np.round(beats_apart)).max()),
        residual_rms_sec=float(np.sqrt((residuals ** 2).mean())),
    )


def report_anchors(report: Report, grid: AnchorGrid) -> None:
    """Prints how well the window fits join into one beat sequence."""
    report.line(f'Window anchors: tempo and phase fitted in {len(grid.clarity)} windows of '
                f'{ANCHOR_WINDOW_SEC:.0f} s, each tied to its neighbour. {int(holds_beat(grid.clarity).sum())} '
                'hold a clear beat.')
    report.line(f'Beats between neighbouring windows: at most {grid.worst_count_error:.3f} from a whole number. '
                f'Anchors lie {grid.residual_rms_sec * 1000:.1f} ms RMS from the smooth tempo curve.')


# --- Kick alignment ---


@dataclass(frozen=True)
class KickSection:
    """How the kick drum lines up with the beats in one section of the song."""

    start_sec: float
    end_sec: float
    beats: int
    # Peak of the kick here, as a share of the strongest section's peak.
    strength: float
    # Rise from the lowest point before the peak to the peak, as a share of the peak.
    contrast: float
    # Time from the beat to where the kick reaches half height, or None when it has no rise.
    half_rise_sec: float | None

    @property
    def clear(self) -> bool:
        """True when the section has a kick clear enough to set the beat phase."""
        return (self.half_rise_sec is not None and self.beats >= KICK_MIN_BEATS
                and self.contrast >= KICK_MIN_CONTRAST and self.strength >= KICK_MIN_STRENGTH)


def kick_amplitude(samples: np.ndarray) -> np.ndarray:
    """Returns the amplitude of the kick band, sample by sample, as a short RMS.

    An onset envelope peaks a little before the true onset. The amplitude itself shows where
    the kick rises, so it sets the final beat phase.
    """
    band_pass = butter(4, KICK_BAND_HZ, btype='band', fs=ANALYSIS_RATE, output='sos')
    band = sosfiltfilt(band_pass, samples)
    window = int(KICK_RMS_SEC * ANALYSIS_RATE)
    return np.sqrt(np.convolve(band ** 2, np.ones(window) / window, mode='same'))


def kick_profile(amplitude: np.ndarray, beats: np.ndarray) -> np.ndarray:
    """Returns the mean kick amplitude around the beats, one value per ms of KICK_PROFILE_MS."""
    offsets_sec = np.arange(KICK_PROFILE_MS[0], KICK_PROFILE_MS[1] + 1) / 1000
    indices = np.round((beats[:, None] + offsets_sec) * ANALYSIS_RATE).astype(int)
    return amplitude[np.clip(indices, 0, len(amplitude) - 1)].mean(axis=0)


def half_rise_ms(profile: np.ndarray) -> float | None:
    """Returns where the profile rises to half height before its peak, in ms from the beat.

    Half height is halfway from the lowest point before the peak to the peak. Returns None
    when the profile has no rise inside the window.
    """
    peak = int(np.argmax(profile))
    if peak == 0:
        return None
    half = (profile[:peak].min() + profile[peak]) / 2
    above = peak
    while above > 0 and profile[above - 1] >= half:
        above -= 1
    if above == 0:
        return None
    step_share = (half - profile[above - 1]) / (profile[above] - profile[above - 1])
    return KICK_PROFILE_MS[0] + above - 1 + float(step_share)


def measure_kick(amplitude: np.ndarray, beats: np.ndarray, section_sec: float = KICK_SECTION_SEC) -> list[KickSection]:
    """Returns the kick alignment of each section of the song that has beats."""
    profiles = []
    for start_sec in np.arange(0, beats[-1], section_sec):
        section_beats = beats[(beats >= start_sec) & (beats < start_sec + section_sec)]
        if len(section_beats):
            profiles.append((float(start_sec), len(section_beats), kick_profile(amplitude, section_beats)))

    strongest = max(profile.max() for _, _, profile in profiles)
    sections = []
    for start_sec, count, profile in profiles:
        peak = int(np.argmax(profile))
        low = profile[:peak + 1].min()
        rise_ms = half_rise_ms(profile)
        sections.append(KickSection(
            start_sec=start_sec,
            end_sec=start_sec + section_sec,
            beats=count,
            strength=float(profile.max() / max(strongest, 1e-12)),
            contrast=float((profile[peak] - low) / max(profile[peak], 1e-12)),
            half_rise_sec=None if rise_ms is None else rise_ms / 1000,
        ))
    return sections


def kick_shift_sec(sections: list[KickSection]) -> float | None:
    """Returns how far to move every beat so it sits just before the kick's half-rise.

    Only sections with a clear kick vote, by their median. Returns None when no section has one.
    """
    half_rises = [section.half_rise_sec for section in sections if section.clear]
    if not half_rises:
        return None
    return float(np.median(half_rises)) - BEAT_BEFORE_HALF_RISE_SEC


def kick_scatter(amplitude: np.ndarray, beats: np.ndarray) -> tuple[int, float]:
    """Returns how many short blocks have a clear kick on these beats, and how far it strays in them.

    The second value is the RMS distance, in seconds, of the kick from its usual place against
    the beat. Beats that follow the music keep the kick in one place. This is how two beat
    grids for one song are compared.
    """
    half_rises = np.array([section.half_rise_sec for section in measure_kick(amplitude, beats, KICK_COMPARE_SEC)
                           if section.clear])
    if len(half_rises) == 0:
        return 0, math.inf
    return len(half_rises), float(np.sqrt(((half_rises - np.median(half_rises)) ** 2).mean()))


def report_kick(report: Report, shift_sec: float | None, sections: list[KickSection]) -> None:
    """Prints the shift and the alignment of each section after it."""
    target_ms = BEAT_BEFORE_HALF_RISE_SEC * 1000
    report.section('Kick alignment')
    if shift_sec is None:
        report.warn('No section has a clear kick drum. The beat phase comes from the onset envelopes '
                    'alone and can be tens of milliseconds off.')
    else:
        report.line(f'All beats moved by {shift_sec * 1000:+.1f} ms, to sit {target_ms:.0f} ms before '
                    'the point where the kick reaches half height.')
    report.line(f'After that, per {KICK_SECTION_SEC:.0f} s (a kick on the beat reads about +{target_ms:.0f} ms):')
    report.line('  section          beats   kick strength   half height after the beat')
    for section in sections:
        span = f'{section.start_sec:4.0f} to {section.end_sec:4.0f} s'
        if section.clear:
            reading = f'{section.half_rise_sec * 1000:+6.1f} ms'
        else:
            reading = 'no clear kick'
        report.line(f'  {span}   {section.beats:5d}   {section.strength:13.2f}   {reading}')

    unclear = [f'{section.start_sec:.0f} to {section.end_sec:.0f} s' for section in sections if not section.clear]
    if unclear and shift_sec is not None:
        report.warn(f'No clear kick in {", ".join(unclear)}: the beat times there are less certain.')
    for section in sections:
        if section.clear and abs(section.half_rise_sec - BEAT_BEFORE_HALF_RISE_SEC) > KICK_WARN_SEC:
            report.warn(f'From {section.start_sec:.0f} to {section.end_sec:.0f} s the kick is '
                        f'{(section.half_rise_sec - BEAT_BEFORE_HALF_RISE_SEC) * 1000:+.0f} ms off the beat.')


# --- Per-beat measurements ---


def beat_intervals(beats: np.ndarray) -> np.ndarray:
    """Returns the time from each beat to the next. The last beat gets the interval before it."""
    gaps = np.diff(beats)
    return np.append(gaps, gaps[-1])


def beat_level_db(samples: np.ndarray, beats: np.ndarray) -> np.ndarray:
    """Returns the RMS level of each beat, from its time to the next beat, in dB."""
    levels = []
    for beat, interval in zip(beats, beat_intervals(beats)):
        span = samples[int(beat * ANALYSIS_RATE):int((beat + interval) * ANALYSIS_RATE)]
        levels.append(np.sqrt((span ** 2).mean() + 1e-12) if len(span) else 1e-6)
    return 20 * np.log10(np.array(levels))


def frame_level_db(samples: np.ndarray) -> np.ndarray:
    """Returns the RMS level of each 10 ms of the song, in dB."""
    frames = samples[:len(samples) // LEVEL_FRAME * LEVEL_FRAME].reshape(-1, LEVEL_FRAME)
    return 10 * np.log10((frames ** 2).mean(axis=1) + 1e-12)


def beat_typical_db(frame_db: np.ndarray, beats: np.ndarray) -> np.ndarray:
    """Returns the median 10 ms level inside each beat, in dB.

    Unlike the RMS, the median stays low for a beat that only holds the tail of the last note.
    """
    typical = []
    for beat, interval in zip(beats, beat_intervals(beats)):
        first = int(beat / LEVEL_FRAME_SEC)
        last = max(first + 1, int((beat + interval) / LEVEL_FRAME_SEC))
        inside = frame_db[first:last]
        typical.append(float(np.median(inside)) if len(inside) else -120.0)
    return np.array(typical)


def beat_onset_strength(envelope: np.ndarray, beats: np.ndarray) -> np.ndarray:
    """Returns the largest envelope value near each beat: how hard the beat is hit."""
    strengths = []
    for beat in beats:
        first = max(0, int((beat + ONSET_WINDOW_SEC[0]) / FRAME_SEC))
        last = max(first + 1, int((beat + ONSET_WINDOW_SEC[1]) / FRAME_SEC))
        strengths.append(float(envelope[first:last].max()) if first < len(envelope) else 0.0)
    return np.array(strengths)


def nearest_beats(beats: np.ndarray, others: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Returns, for each beat, the index of the nearest of the other beats and the time from it."""
    after = np.clip(np.searchsorted(others, beats), 1, len(others) - 1)
    nearest = np.where(beats - others[after - 1] < others[after] - beats, after - 1, after)
    return nearest, beats - others[nearest]


# --- First and last beat of the music ---


@dataclass(frozen=True)
class MusicSpan:
    """Which beats of the file-wide grid have music."""

    first_sound_sec: float
    # Index in the grid of the first beat of the music, and of the last beat that has sound.
    first: int
    last: int


def find_music_span(samples: np.ndarray, grid: np.ndarray, onset_strength: np.ndarray,
                    earliest_sec: float) -> MusicSpan:
    """Returns the first beat of the music and the last beat with sound.

    The first beat is the one the sound starts on: it may sit a quarter beat into the sound,
    never more before it. `earliest_sec` keeps the first beat inside Chrome's decode.
    The last beat with sound is the last that holds its level or has a hit on it. After it
    comes the ring-out of the last note. `onset_strength` has one value per beat of `grid`.
    """
    frame_db = frame_level_db(samples)
    loud_db = np.percentile(frame_db, LOUD_PERCENTILE)
    first_sound_sec = float(np.argmax(frame_db >= loud_db - SILENCE_BELOW_LOUD_DB) * LEVEL_FRAME_SEC)

    intervals = beat_intervals(grid)
    starts_music = grid >= np.maximum(earliest_sec, first_sound_sec - intervals / 4)
    holds_level = beat_typical_db(frame_db, grid) >= loud_db - RING_OUT_BELOW_LOUD_DB
    has_hit = onset_strength >= HIT_SHARE_OF_TYPICAL * np.median(onset_strength)
    has_sound = holds_level | has_hit
    first = int(np.argmax(starts_music))
    last = int(np.flatnonzero(has_sound)[-1]) if has_sound.any() else first - 1
    if last - first + 1 < MIN_BEATS:
        raise SongError(f'Only {max(0, last - first + 1)} beats have music. A song needs at least {MIN_BEATS}.')
    return MusicSpan(first_sound_sec=first_sound_sec, first=first, last=last)


@dataclass(frozen=True)
class ClearBeat:
    """Where the song holds a clear beat, and where it does not."""

    # No window before this time holds a clear beat. None when the first window does.
    from_sec: float | None
    # No window after this time holds a clear beat. None when the last window does.
    to_sec: float | None
    # Parts in between with no clear beat, as (start, end) times.
    gaps: list[tuple[float, float]]


def constant_grid_clarity(envelope: np.ndarray, grid: ConstantGrid, duration_sec: float) -> np.ndarray:
    """Returns how clear the beat is in each window of a song with one constant tempo.

    The best phase counts, not the grid's own: the grid follows the kick, and other
    percussion can sit some tens of milliseconds from it.
    """
    clarity = []
    for centre_sec in window_centres(duration_sec):
        by_phase = phase_scores(envelope, float(centre_sec), grid.bpm, grid.phase_sec)
        clarity.append(float(by_phase.max() / max(float(np.median(by_phase)), 1e-9)))
    return np.array(clarity)


def find_clear_beat(clarity: np.ndarray, duration_sec: float) -> ClearBeat:
    """Returns where the song holds a clear beat, from the clarity of each of its windows."""
    centres = window_centres(duration_sec)
    holding = holds_beat(clarity)
    if not holding.any():
        raise SongError('No part of the song has a clear beat.')
    first, last = np.flatnonzero(holding)[[0, -1]]
    return ClearBeat(
        from_sec=None if first == 0 else float(centres[first]),
        to_sec=None if last == len(centres) - 1 else float(centres[last]),
        gaps=[(float(centres[start - 1]), float(centres[stop]))
              for start, stop in runs_of_true(~holding) if start > first and stop <= last],
    )


def report_clear_beat(report: Report, clear: ClearBeat) -> None:
    """Warns about the parts of the song with no clear beat before its end. The end is dealt with later."""
    if clear.from_sec is not None:
        report.warn(f'No clear beat before {clear.from_sec:.0f} s. The beats there carry on the tempo of the '
                    'first clear part and are less certain.')
    for start_sec, end_sec in clear.gaps:
        report.warn(f'No clear beat from {start_sec:.0f} to {end_sec:.0f} s. The beats there carry on the tempo '
                    'before it and are less certain.')


def clear_beat_count(sounding: np.ndarray, clear_to_sec: float | None) -> int | None:
    """Returns how many of the beats with sound come before the beat stops being clear.

    Returns None when the beat is clear to the end of the music. A beatless stretch shorter
    than BEATLESS_END_MIN_SEC is the song's own ending, and the ending rules deal with it.
    A longer one has no beat to trust, so the grid does not run through it.
    """
    if clear_to_sec is None or sounding[-1] - clear_to_sec < BEATLESS_END_MIN_SEC:
        return None
    return int(np.searchsorted(sounding, clear_to_sec, side='right'))


def last_listed_beat(onset_strength: np.ndarray, first_downbeat: int, music_goes_on: bool) -> tuple[int, str]:
    """Returns the index of the last beat for the manifest, and a few words on what that beat is.

    `onset_strength` has one value for each beat that may be listed. The list covers the full
    bars. A song often ends with one more hit, on the bar start after its last full bar: that
    beat is listed too when it is hit as hard as a typical beat. A held note or a ring-out
    there is not. When the music goes on with no clear beat, the list stops on its last bar
    start: the game gives no cues from the last bar start on, so no clear bar is lost.
    """
    count = len(onset_strength)
    if music_goes_on:
        last_bar = (count - 1 - first_downbeat) // BEATS_PER_BAR
        return first_downbeat + last_bar * BEATS_PER_BAR, 'the last bar start with a clear beat'

    after_full_bars = (count - first_downbeat) % BEATS_PER_BAR
    if after_full_bars == 0:
        return count - 1, 'the end of the last full bar, where the music ends'
    bar_start = count - after_full_bars
    strength, typical = onset_strength[bar_start], float(np.median(onset_strength))
    if strength >= typical:
        return bar_start, (f'the final hit, on the bar start after the last full bar (onset strength '
                           f'{strength:.1f}; a typical beat has {typical:.1f})')
    return bar_start - 1, (f'the end of the last full bar. The bar start after it has no clear hit (onset '
                           f'strength {strength:.1f}; a typical beat has {typical:.1f})')


def report_music(report: Report, sounding: np.ndarray, span: MusicSpan, clear_beats: int | None) -> None:
    """Prints where the music starts and ends, and where the beat stops being clear before the end.

    `sounding` holds every beat with sound, also those after the clear beat.
    """
    report.section('Music')
    report.line(f'Sound starts at {span.first_sound_sec:.2f} s. The first beat of the music is at {sounding[0]:.3f} s.')
    report.line(f'The last beat with sound is beat index {len(sounding) - 1}, at {sounding[-1]:.2f} s. '
                'After it comes ring-out or silence.')
    if clear_beats is not None:
        report.warn(f'The beat is not clear after {sounding[clear_beats - 1]:.0f} s, and the music lasts until '
                    f'{sounding[-1]:.0f} s. The beat list stops there, on a bar start: the game gives no cues '
                    'in the rest of the song.')


# --- Bars ---


@dataclass(frozen=True)
class BarClue:
    """One kind of evidence for which beat starts the bars."""

    name: str
    weight: float
    # The beat, 0 to 3, this clue says starts a bar. None when the clue does not decide.
    choice: int | None
    detail: str


@dataclass(frozen=True)
class BarChoice:
    """The tool's choice of the beat that starts the bars."""

    first_downbeat: int
    # 'high', 'medium' or 'low'.
    confidence: str
    # True when a clue points to another beat.
    disagrees: bool
    # Which clues are for the choice, against it, and undecided.
    statement: str


def start_clue() -> BarClue:
    """The music starts on a bar start. Songs made with Suno do."""
    return BarClue('song start', START_WEIGHT, 0, 'the music starts on beat 0')


def level_rises(level_db: np.ndarray) -> list[tuple[int, float]]:
    """Returns the largest rises in level as (beat index, dB), in beat order.

    A rise compares the mean level of the beats from an index with the beats before it.
    Large rises are section starts, and sections start on bar starts.
    """
    span = RISE_SPAN_BEATS
    rise_db = np.zeros(len(level_db))
    for index in range(span, len(level_db) - span + 1):
        rise_db[index] = level_db[index:index + span].mean() - level_db[index - span:index].mean()

    picked: list[int] = []
    for index in np.argsort(rise_db)[::-1]:
        if rise_db[index] < RISE_MIN_DB or len(picked) == RISE_COUNT:
            break
        if all(abs(index - other) > RISE_SEPARATION_BEATS for other in picked):
            picked.append(int(index))
    return [(index, float(rise_db[index])) for index in sorted(picked)]


def decisive_choice(scores: np.ndarray, ratio: float) -> int | None:
    """Returns the best-scoring beat, or None when the next best is within `ratio` of it."""
    order = np.argsort(scores)[::-1]
    best, second = scores[order[0]], scores[order[1]]
    return int(order[0]) if best > 0 and best >= ratio * second else None


def rises_clue(rises: list[tuple[int, float]]) -> BarClue:
    """Level rises fall on bar starts, or one beat before them after a pickup or a fill."""
    scores = np.zeros(BEATS_PER_BAR)
    for index, _ in rises:
        scores[index % BEATS_PER_BAR] += 1
        scores[(index + 1) % BEATS_PER_BAR] += RISE_ONE_EARLY_WEIGHT
    detail = 'rises that fit, if bars start on   ' + '   '.join(
        f'beat {beat}: {score:g}' for beat, score in enumerate(scores))
    return BarClue('level rises', RISES_WEIGHT, decisive_choice(scores, RISE_DECISIVE_RATIO), detail)


def chroma_change_by_beat(chroma: np.ndarray, beats: np.ndarray) -> np.ndarray:
    """Returns how much the notes change from the beat before, for each beat, from 0 to 1."""
    frame_times = np.arange(chroma.shape[1]) * CHROMA_HOP / ANALYSIS_RATE
    per_beat = np.zeros((len(beats), chroma.shape[0]))
    for row, (beat, interval) in enumerate(zip(beats, beat_intervals(beats))):
        inside = (frame_times >= beat + CHROMA_INSET_SEC) & (frame_times < beat + interval - CHROMA_INSET_SEC)
        if inside.any():
            per_beat[row] = chroma[:, inside].mean(axis=1)
    per_beat /= np.linalg.norm(per_beat, axis=1, keepdims=True) + 1e-9
    return np.concatenate(([0.0], 1 - (per_beat[1:] * per_beat[:-1]).sum(axis=1)))


def harmony_chroma(samples: np.ndarray, harmonic: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Returns the chroma of the chords and of the bass: which notes sound, frame by frame."""
    chords = librosa.feature.chroma_cqt(y=harmonic, sr=ANALYSIS_RATE, hop_length=CHROMA_HOP)
    bass = librosa.feature.chroma_cqt(y=samples, sr=ANALYSIS_RATE, hop_length=CHROMA_HOP,
                                      fmin=librosa.note_to_hz('C1'), n_octaves=3)
    return chords, bass


def harmony_change(harmony: tuple[np.ndarray, np.ndarray], beats: np.ndarray) -> np.ndarray:
    """Returns how much chords and bass change at each beat. 1 is the mean over all beats."""
    change = np.zeros(len(beats))
    for chroma in harmony:
        by_beat = chroma_change_by_beat(chroma, beats)
        change += by_beat / max(float(by_beat.mean()), 1e-9) / len(harmony)
    return change


def chords_clue(harmony: tuple[np.ndarray, np.ndarray], beats: np.ndarray) -> BarClue:
    """Chords and bass notes change on bar starts."""
    change = harmony_change(harmony, beats)
    position = np.arange(len(beats)) % BEATS_PER_BAR
    scores = np.array([change[position == beat].mean() for beat in range(BEATS_PER_BAR)])
    detail = 'chord and bass change, on   ' + '   '.join(
        f'beat {beat}: {score:.2f}' for beat, score in enumerate(scores))
    return BarClue('chord changes', CHORDS_WEIGHT, decisive_choice(scores, CHORD_DECISIVE_RATIO), detail)


def choose_bar_start(clues: list[BarClue]) -> BarChoice:
    """Returns the beat that starts the bars, with a plain statement of how sure the clues are.

    Each clue that decides votes with its weight, and a tie goes to the earlier beat.
    Confidence is high when the clues for the winner weigh CERTAIN_WEIGHT and none is against
    it, low when a full-weight clue is against it.
    """
    votes = np.zeros(BEATS_PER_BAR)
    for clue in clues:
        if clue.choice is not None:
            votes[clue.choice] += clue.weight
    winner = int(np.argmax(votes))

    agreeing = [clue for clue in clues if clue.choice == winner]
    against = [clue for clue in clues if clue.choice not in (None, winner)]
    undecided = [clue for clue in clues if clue.choice is None]

    if any(clue.weight >= 1 for clue in against):
        confidence = 'low'
    elif against or sum(clue.weight for clue in agreeing) < CERTAIN_WEIGHT:
        confidence = 'medium'
    else:
        confidence = 'high'

    def names(group: list[BarClue]) -> str:
        """Returns the names of the clues in a group, as text."""
        return ', '.join(clue.name for clue in group) or 'none'

    return BarChoice(
        first_downbeat=winner,
        confidence=confidence,
        disagrees=bool(against),
        statement=f'For beat {winner}: {names(agreeing)}. Against: {names(against)}. Undecided: {names(undecided)}.',
    )


def meter_repeat_scores(envelopes: Envelopes, beats: np.ndarray) -> tuple[float, float]:
    """Returns how strongly the accents repeat after 3 beats and after 4 beats, from -1 to 1.

    In 4/4 the pattern of strong and weak beats repeats after 4 beats, not after 3.
    """
    def repeat(strengths: np.ndarray, lag: int) -> float:
        """Returns the autocorrelation of the strengths at a lag of `lag` beats."""
        centred = (strengths - strengths.mean()) / (strengths.std() + 1e-9)
        return float((centred[lag:] * centred[:-lag]).mean())

    per_beat = [beat_onset_strength(envelope, beats) for envelope in (envelopes.percussive, envelopes.kick)]
    after_three = float(np.mean([repeat(strengths, 3) for strengths in per_beat]))
    after_four = float(np.mean([repeat(strengths, 4) for strengths in per_beat]))
    return after_three, after_four


def report_bars(report: Report, rises: list[tuple[int, float]], clues: list[BarClue], choice: BarChoice,
                override: int | None, meter: tuple[float, float]) -> None:
    """Prints the meter check, each clue for the bar start, the choice and how sure it is."""
    after_three, after_four = meter
    report.section('Bars')
    report.line(f'Accents repeat after 4 beats: {after_four:.2f}, after 3 beats: {after_three:.2f} '
                '(1 is a perfect repeat).')
    if after_three >= after_four:
        report.warn(f'The meter does not look like 4/4. The manifest still says {BEATS_PER_BAR} beats per bar.')

    listed = '   '.join(f'{index}: +{rise:.1f}' for index, rise in rises) or 'none'
    report.line(f'Level rises of {RISE_MIN_DB:g} dB or more (beat index: dB):   {listed}')
    report.line(f'A rise on a bar start fits (1). A rise one beat early fits in part ({RISE_ONE_EARLY_WEIGHT:g}).')
    report.line('Which beat starts the bars, counted from the first beat of the music:')
    for clue in clues:
        verdict = 'undecided' if clue.choice is None else f'beat {clue.choice}'
        report.line(f'  {clue.name:15s} {verdict:11s} {clue.detail}')

    report.line(f'The tool chooses firstDownbeat {choice.first_downbeat}. Confidence: {choice.confidence}. '
                f'{choice.statement}')
    if choice.disagrees:
        report.warn(f'The bar-start evidence disagrees. {choice.statement} Listen for the high click in the '
                    'check clips, and give --first-downbeat if it is on the wrong beat.')
    elif choice.confidence != 'high':
        report.warn(f'The bar start is not certain. {choice.statement} Listen for the high click in the '
                    'check clips.')
    if override is not None:
        report.line(f'--first-downbeat {override} overrules the tool.')


# --- Intensity ---


def scale_between_percentiles(values: np.ndarray) -> np.ndarray:
    """Returns the values scaled so the low percentile is 0 and the high one is 1, clipped."""
    low, high = np.percentile(values, INTENSITY_PERCENTILES)
    return np.clip((values - low) / (high - low + 1e-9), 0, 1)


def bar_intensity(level_db: np.ndarray, density: np.ndarray, first_downbeat: int) -> np.ndarray:
    """Returns the musical energy of each full bar, from 0 to 1.

    A beat's energy mixes its level with how busy the drums are. A bar takes the mean of its
    beats, then the median with its neighbours, so one odd bar does not change the game's pace.
    """
    per_beat = LEVEL_SHARE * scale_between_percentiles(level_db) + DENSITY_SHARE * scale_between_percentiles(density)
    full_bars = (len(per_beat) - first_downbeat) // BEATS_PER_BAR
    in_bars = per_beat[first_downbeat:first_downbeat + full_bars * BEATS_PER_BAR]
    per_bar = in_bars.reshape(full_bars, BEATS_PER_BAR).mean(axis=1)
    return median_filter(per_bar, size=INTENSITY_MEDIAN_BARS, mode='nearest')


def pace_by_rank(per_bar: np.ndarray) -> np.ndarray:
    """Returns the bar intensities mapped by rank, so every song has the same pace mix.

    A song with a wide dynamic range would otherwise play slow for much of its length. The
    quietest bars land below the first intensity step, the next between the steps, the rest
    above. A median over neighbours follows, as for the levels.
    """
    rank = np.argsort(np.argsort(per_bar, kind='stable'), kind='stable') / max(1, len(per_bar) - 1)
    paced = np.interp(rank, [0, *RANK_PACING_SHARES, 1], [0, *INTENSITY_STEPS, 1])
    return median_filter(paced, size=INTENSITY_MEDIAN_BARS, mode='nearest')


def pace_shares(per_bar: np.ndarray) -> tuple[float, float, float]:
    """Returns the share of bars the game plays slow, medium and full."""
    low, high = INTENSITY_STEPS
    return (float((per_bar < low).mean()), float(((per_bar >= low) & (per_bar < high)).mean()),
            float((per_bar >= high).mean()))


def beat_intensity(per_bar: np.ndarray, beats: int, first_downbeat: int) -> np.ndarray:
    """Returns one intensity per beat: its bar's value. Beats outside a full bar take the nearest bar's."""
    bar_of_beat = (np.arange(beats) - first_downbeat) // BEATS_PER_BAR
    return per_bar[np.clip(bar_of_beat, 0, len(per_bar) - 1)]


def percussive_density(percussive: np.ndarray, beats: np.ndarray) -> np.ndarray:
    """Returns the mean percussive envelope inside each beat: how busy the drums are."""
    density = []
    for beat, interval in zip(beats, beat_intervals(beats)):
        first = int(beat / FRAME_SEC)
        last = max(first + 1, int((beat + interval) / FRAME_SEC))
        density.append(float(percussive[first:last].mean()))
    return np.array(density)


def report_intensity(report: Report, per_bar: np.ndarray, pacing: str) -> None:
    """Prints the intensity of each bar, and the share of bars at each pace of the game."""
    slow, medium, full = pace_shares(per_bar)
    low, high = INTENSITY_STEPS
    report.section(f'Intensity per bar (pacing: {pacing})')
    for row_start in range(0, len(per_bar), 16):
        row = ' '.join(f'{value:.2f}' for value in per_bar[row_start:row_start + 16])
        report.line(f'bar {row_start:3d}   {row}')
    report.line(f'Slow bars (below {low}): {slow:.0%}.   Medium ({low} to {high}): {medium:.0%}.   '
                f'Full ({high} and above): {full:.0%}.')


# --- Short round ---


@dataclass(frozen=True)
class ShortStart:
    """The best place to start the Short round, and the numbers behind the choice."""

    # Bar where the round starts, counted from the first downbeat. None is the start of the song.
    bar: int | None
    # Mean intensity of the 90 s from the start of the song, and of the best 90 s.
    first_mean: float
    best_mean: float
    best_bar: int
    # True when the best 90 s are the last, and the start is moved so the round ends with the song.
    runs_to_end: bool


def manifest_bars(manifest: dict) -> tuple[np.ndarray, np.ndarray]:
    """Returns the start time and the intensity of each full bar of a manifest."""
    per_bar = manifest['beatsPerBar']
    beats = np.array(manifest['beats'], dtype=float)
    starts = np.arange(manifest['firstDownbeat'], len(beats) - per_bar + 1, per_bar)
    return beats[starts], np.array(manifest['intensity'], dtype=float)[starts]


def short_round_sec(manifest: dict) -> float:
    """Returns how long the Short round lasts, as `playStartSec` and `playEndSec` in manifest.ts give it."""
    start_sec = manifest.get('shortStartSec', 0.0)
    bar_starts = manifest['beats'][manifest['firstDownbeat']::manifest['beatsPerBar']]
    ends = [time for time in bar_starts if time >= start_sec + SHORT_ROUND_SEC]
    return (ends[0] if ends else manifest['durationSec']) - start_sec


def choose_short_start(manifest: dict) -> ShortStart:
    """Returns where the Short round has the most to play.

    Each candidate is a bar start a multiple of 4 bars from the first downbeat, with 90 s of
    beats after it. Its value is the mean intensity of the bars in those 90 s. A later start
    must beat the first 90 s by SHORT_START_MIN_GAIN. When the best 90 s are the last, the
    round starts a little later, so that it ends with the song and not a few bars before.
    """
    bar_times, per_bar = manifest_bars(manifest)
    last_beat_sec = manifest['beats'][-1]

    def mean_from(bar: int) -> float:
        """Returns the mean intensity of the bars in the 90 s from the start of this bar."""
        in_round = (bar_times >= bar_times[bar]) & (bar_times < bar_times[bar] + SHORT_ROUND_SEC)
        return float(per_bar[in_round].mean())

    candidates = range(0, len(bar_times), SHORT_START_EVERY_BARS)
    full_rounds = [bar for bar in candidates if bar_times[bar] + SHORT_ROUND_SEC <= last_beat_sec]
    first_mean = mean_from(0)
    if not full_rounds:
        return ShortStart(bar=None, first_mean=first_mean, best_mean=first_mean, best_bar=0, runs_to_end=False)
    best = max(full_rounds, key=mean_from)
    if mean_from(best) - first_mean < SHORT_START_MIN_GAIN:
        return ShortStart(bar=None, first_mean=first_mean, best_mean=mean_from(best), best_bar=best,
                          runs_to_end=False)

    to_end = next(bar for bar in candidates if bar_times[bar] >= last_beat_sec - SHORT_ROUND_SEC)
    runs_to_end = (best == full_rounds[-1]
                   and manifest['durationSec'] - bar_times[to_end] < SHORT_ROUND_LIMITS_SEC[1])
    return ShortStart(bar=to_end if runs_to_end else best, first_mean=first_mean, best_mean=mean_from(best),
                      best_bar=best, runs_to_end=runs_to_end)


def short_start_sec(report: Report, job: Job, manifest: dict) -> float | None:
    """Returns the time for `shortStartSec`, or None to leave it out. Prints how it was chosen."""
    bar_times, _ = manifest_bars(manifest)
    choice = choose_short_start(manifest)
    report.section('Short round')
    report.line(f'Mean intensity of the bars in {SHORT_ROUND_SEC:.0f} s: {choice.first_mean:.2f} from the start of '
                f'the song, {choice.best_mean:.2f} from bar {choice.best_bar} ({bar_times[choice.best_bar]:.2f} s), '
                'the best start.')

    if job.short_start == 'none':
        report.line('--short-start none: no shortStartSec. The Short round starts with the song.')
        return None
    if job.short_start != 'auto':
        nearest = int(np.argmin(np.abs(bar_times - job.short_start)))
        report.line(f'--short-start {job.short_start:g}: shortStartSec {bar_times[nearest]}, the nearest bar '
                    f'start (bar {nearest}).')
        return float(bar_times[nearest])
    if choice.bar is None:
        report.line(f'The best start is less than {SHORT_START_MIN_GAIN} better than the start of the song: '
                    'no shortStartSec.')
        return None
    if choice.runs_to_end:
        report.line(f'The best {SHORT_ROUND_SEC:.0f} s are the last. The round starts at bar {choice.bar}, '
                    'so that it ends with the song.')
    report.line(f'shortStartSec {bar_times[choice.bar]} (bar {choice.bar}).')
    return float(bar_times[choice.bar])


# --- Manifest ---


def tempo_bpm(beats: np.ndarray, first_interval: int) -> float:
    """Returns the mean tempo over TEMPO_SPAN_BEATS intervals, starting at `first_interval`."""
    intervals = np.diff(beats)[max(0, first_interval):first_interval + TEMPO_SPAN_BEATS]
    return float(60 / intervals.mean())


def manifest_duration_sec(chrome: ChromeDecode) -> float:
    """Returns the manifest's `durationSec`: Chrome's length less the margin, rounded down to 0.01 s."""
    return math.floor((chrome.duration_sec - DURATION_MARGIN_SEC) * 100 + 1e-6) / 100


def manifest_beats(beats: np.ndarray, chrome: ChromeDecode) -> list[float]:
    """Returns the beat times as the manifest writes them: in Chrome's time, rounded to 0.1 ms.

    The beats come in ffmpeg's decode. They move to Chrome's here, because the game plays Chrome's.
    """
    return [round(float(time), 4) for time in beats + chrome.offset_sec]


def beats_before_end(beats: np.ndarray, chrome: ChromeDecode) -> int:
    """Returns how many of the beats, in ffmpeg's decode, fall before the manifest's end.

    The manifest ends DURATION_MARGIN_SEC before the audio does, so a beat in the last few
    milliseconds of the audio lies past it, and the game would refuse the manifest. The test
    uses the beat times exactly as the manifest writes them.
    """
    end_sec = manifest_duration_sec(chrome)
    return sum(1 for time in manifest_beats(beats, chrome) if time < end_sec)


def build_manifest(job: Job, beats: np.ndarray, intensity: np.ndarray, first_downbeat: int,
                   chrome: ChromeDecode) -> dict:
    """Returns the manifest, with keys in the order of the `Manifest` type in types.ts.

    Beat times move from ffmpeg's decode to Chrome's here, because the game plays Chrome's.
    """
    game_beats = beats + chrome.offset_sec
    duration_sec = manifest_duration_sec(chrome)
    return {
        'id': job.song_id,
        'title': job.title,
        'audio': job.audio_url,
        'durationSec': duration_sec,
        'bpm': round(float(60 / np.median(np.diff(game_beats))), 3),
        'beatsPerBar': BEATS_PER_BAR,
        'firstDownbeat': first_downbeat,
        'beats': manifest_beats(beats, chrome),
        'intensity': [round(float(value), 3) for value in intensity],
    }


def with_short_start(manifest: dict, start_sec: float | None) -> dict:
    """Returns the manifest with `shortStartSec` after `durationSec`, where the `Manifest` type has it.

    None leaves the field out: the Short round then starts with the song.
    """
    if start_sec is None:
        return manifest
    placed = {}
    for key, value in manifest.items():
        placed[key] = value
        if key == 'durationSec':
            placed['shortStartSec'] = start_sec
    return placed


def check_manifest(manifest: dict) -> None:
    """Raises SongError when the manifest breaks a rule of the game.

    The first rules repeat `validateManifest` in src/game/manifest.ts. The last two repeat the
    song test in src/game/songs.test.ts: every beat interval within 5% of the median, and a
    Short round of 60 to 95 s.
    """
    def is_number(value: object) -> bool:
        """Returns True for a finite number, as `Number.isFinite` does in the game."""
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)

    def fail(message: str) -> None:
        """Raises the error for one broken rule."""
        raise SongError(f'The manifest would fail the game\'s check: {message}')

    if not manifest['id'].strip() or not manifest['title'].strip():
        fail('id and title are required.')
    if not re.fullmatch(r'/(?!/)[^\\\s]*', manifest['audio']):
        fail('audio must be a local absolute path.')
    if not (is_number(manifest['durationSec']) and manifest['durationSec'] > 0
            and is_number(manifest['bpm']) and manifest['bpm'] > 0):
        fail('durationSec and bpm must be positive.')
    short_start = manifest.get('shortStartSec', 0.0)
    if not (is_number(short_start) and 0 <= short_start < manifest['durationSec']):
        fail('shortStartSec must be a time inside the song.')
    if not isinstance(manifest['beatsPerBar'], int) or manifest['beatsPerBar'] < 1:
        fail('beatsPerBar must be a positive integer.')

    beats = manifest['beats']
    in_song = all(is_number(time) and 0 <= time < manifest['durationSec'] for time in beats)
    increasing = all(later > earlier for earlier, later in zip(beats, beats[1:]))
    if len(beats) < 2 or not in_song or not increasing:
        fail('beats must be increasing times inside the song.')
    if not isinstance(manifest['firstDownbeat'], int) or not 0 <= manifest['firstDownbeat'] < len(beats):
        fail('firstDownbeat must be a beat index.')

    intensity = manifest['intensity']
    if len(intensity) != len(beats) or not all(is_number(value) and 0 <= value <= 1 for value in intensity):
        fail('intensity must have one value from 0 to 1 per beat.')

    intervals = np.diff(beats)
    deviation = np.abs(intervals - np.median(intervals)) / np.median(intervals)
    if deviation.max() >= MAX_INTERVAL_DEVIATION:
        worst = int(np.argmax(deviation))
        fail(f'the beat interval at {beats[worst]:.1f} s is {deviation.max() * 100:.0f}% off the median. '
             f'The song test allows less than {MAX_INTERVAL_DEVIATION * 100:.0f}%.')
    shortest, longest = SHORT_ROUND_LIMITS_SEC
    if not shortest < short_round_sec(manifest) < longest:
        fail(f'the Short round would last {short_round_sec(manifest):.0f} s. The song test allows '
             f'{shortest:.0f} to {longest:.0f} s.')


def report_beats(report: Report, manifest: dict, method: str, stops_at: str) -> None:
    """Prints where the beat list stops and why, the beat count and the tempo over the song."""
    beats = np.array(manifest['beats'])
    middle = len(beats) // 2 - TEMPO_SPAN_BEATS // 2
    report.section('Beats')
    report.line(f'The list stops at beat index {len(beats) - 1}: {stops_at}.')
    report.line(f'{len(beats)} beats, {method}, from {beats[0]:.3f} s to {beats[-1]:.3f} s in the game\'s time. '
                f'durationSec {manifest["durationSec"]}.')
    report.line(f'Tempo: {tempo_bpm(beats, 0):.2f} BPM at the start, {tempo_bpm(beats, middle):.2f} in the '
                f'middle, {tempo_bpm(beats, len(beats) - 1 - TEMPO_SPAN_BEATS):.2f} at the end. '
                f'Manifest bpm (from the median interval): {manifest["bpm"]}.')
    if 60 / manifest['bpm'] < MIN_CUE_INTERVAL_SEC:
        report.warn(f'The tempo is above {60 / MIN_CUE_INTERVAL_SEC:.0f} BPM. The game then puts a cue on '
                    f'every second beat, because its minimum cue interval is {MIN_CUE_INTERVAL_SEC} s.')


def write_manifest(job: Job, manifest: dict) -> tuple[Path, Path]:
    """Copies the audio unchanged, writes the manifest, and returns both paths.

    The manifest is one compact line with no line break at the end, as the first two songs have.
    """
    job.out_dir.mkdir(parents=True, exist_ok=True)
    audio_path = job.out_dir / f'{job.song_id}{job.extension}'
    manifest_path = job.out_dir / f'{job.song_id}.json'
    if audio_path.resolve() != job.source:
        shutil.copyfile(job.source, audio_path)
    manifest_path.write_text(json.dumps(manifest, separators=(',', ':')), encoding='utf-8')
    return audio_path, manifest_path


# --- Click-check clips ---


def click(frequency_hz: float) -> np.ndarray:
    """Returns one short decaying sine: the sound that marks a beat in a check clip."""
    time_sec = np.arange(int(CLICK_SEC * ANALYSIS_RATE)) / ANALYSIS_RATE
    return CLICK_GAIN * np.sin(2 * np.pi * frequency_hz * time_sec) * np.exp(-time_sec / CLICK_DECAY_SEC)


def render_clip(samples: np.ndarray, beats: np.ndarray, first_downbeat: int, start_sec: float) -> np.ndarray:
    """Returns CLIP_SEC of the song at reduced level, with a click on every beat.

    Bar starts get the higher click. `beats` are in ffmpeg's decode, like `samples`.
    """
    first_sample = int(start_sec * ANALYSIS_RATE)
    clip = CLIP_SONG_GAIN * samples[first_sample:first_sample + int(CLIP_SEC * ANALYSIS_RATE)]
    clicks = {True: click(BAR_CLICK_HZ), False: click(CLICK_HZ)}
    for index, beat in enumerate(beats):
        at = int(round(beat * ANALYSIS_RATE)) - first_sample
        is_bar_start = index >= first_downbeat and (index - first_downbeat) % BEATS_PER_BAR == 0
        sound = clicks[is_bar_start]
        if 0 <= at <= len(clip) - len(sound):
            clip[at:at + len(sound)] += sound
    return np.clip(clip, -1, 1)


def clip_starts(beats: np.ndarray, sections: list[KickSection]) -> dict[str, float]:
    """Returns where the two check clips start: early where the kick is clear, and at the end."""
    clear_starts = [section.start_sec for section in sections if section.clear]
    early_sec = max(clear_starts[0] if clear_starts else 0.0, beats[0] - 1)
    late_sec = beats[-1] + CLIP_TAIL_SEC - CLIP_SEC
    return {'early': max(0.0, early_sec), 'late': max(0.0, late_sec)}


def write_clips(job: Job, work_dir: Path, samples: np.ndarray, beats: np.ndarray, first_downbeat: int,
                sections: list[KickSection]) -> list[tuple[Path, float]]:
    """Writes the two click-check clips as MP3 and returns each path with its start time."""
    CLIPS_DIR.mkdir(parents=True, exist_ok=True)
    written = []
    for name, start_sec in clip_starts(beats, sections).items():
        wav_path = work_dir / f'clip-{name}.wav'
        mp3_path = CLIPS_DIR / f'{job.song_id}-beat-check-{name}.mp3'
        soundfile.write(wav_path, render_clip(samples, beats, first_downbeat, start_sec), ANALYSIS_RATE)
        result = run_program(
            ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(wav_path),
             '-codec:a', 'libmp3lame', '-q:a', '4', str(mp3_path)],
            FFMPEG_TIMEOUT_SEC,
        )
        if result.returncode != 0:
            raise SongError(f'ffmpeg cannot write {mp3_path}. ffmpeg said: {first_line(result.stderr)}')
        written.append((mp3_path, start_sec))
    return written


# --- Comparison with an existing manifest ---


def report_comparison(report: Report, manifest: dict, reference: dict, reference_path: Path) -> None:
    """Prints how the new manifest differs from the reference: beats, bar starts, Short round, pacing.

    Each of our beats is compared with the nearest of theirs, so the comparison also works when
    one manifest has half the tempo of the other or one more beat at the start.
    """
    ours = np.array(manifest['beats'])
    nearest, difference_sec = nearest_beats(ours, np.array(reference['beats'], dtype=float))
    difference_ms = difference_sec * 1000

    report.section(f'Compared with {reference_path}')
    for key in ('firstDownbeat', 'beatsPerBar', 'durationSec', 'shortStartSec'):
        report.line(f'{key}: {manifest.get(key, "none")} (theirs {reference.get(key, "none")})')
    report.line(f'beats: {len(ours)} (theirs {len(reference["beats"])}). Our first beat is their beat index '
                f'{nearest[0]}, our last is their {nearest[-1]}.')
    if round(float(np.median(np.diff(nearest)))) == 2:
        even = int((nearest % 2 == 0).sum())
        report.line(f'We write half their tempo: {even} of our {len(ours)} beats are their beats of even index, '
                    f'{len(ours) - even} of odd index.')

    our_bar_starts = nearest[manifest['firstDownbeat']::manifest['beatsPerBar']]
    on_theirs = (our_bar_starts - reference['firstDownbeat']) % reference['beatsPerBar'] == 0
    report.line(f'Bar starts: {int(on_theirs.sum())} of our {len(our_bar_starts)} fall on bar starts of theirs.')

    def row(label: str, values: np.ndarray) -> None:
        """Prints the count, mean, RMS and largest difference of one group of beats."""
        largest = values[np.argmax(np.abs(values))]
        report.line(f'  {label}   {len(values):5d}   {values.mean():+8.1f}   {np.sqrt((values ** 2).mean()):8.1f}'
                    f'   {largest:+10.1f}')

    report.line('Our beat time minus the nearest of theirs:')
    report.line('  section          beats    mean ms     RMS ms   largest ms')
    for start_sec in np.arange(0, ours[-1], REPORT_SECTION_SEC):
        in_section = (ours >= start_sec) & (ours < start_sec + REPORT_SECTION_SEC)
        if in_section.any():
            row(f'{start_sec:4.0f} to {start_sec + REPORT_SECTION_SEC:4.0f} s', difference_ms[in_section])
    row('whole song    ', difference_ms)

    shares, their_shares = pace_shares(manifest_bars(manifest)[1]), pace_shares(manifest_bars(reference)[1])
    report.line('Bars that play slow, medium and full: '
                + ', '.join(f'{share:.0%}' for share in shares)
                + ' (theirs ' + ', '.join(f'{share:.0%}' for share in their_shares) + ').')


# --- The beat grid: the method that suits the song ---


@dataclass(frozen=True)
class BeatGrid:
    """Beat times that cover the whole file, and how they were made."""

    beats: np.ndarray
    method: str
    # Where the beat stops being clear before the end of the file, or None when it does not.
    clear_to_sec: float | None


def tracker_beats(report: Report, envelopes: Envelopes, blocks: list[BlockPhase], about_bpm: float,
                  duration_sec: float) -> np.ndarray | None:
    """Returns the beat tracker's beats over the whole file, or None when the tracker cannot be used.

    The tracker reads the kick, so it needs a clear kick in most of the song, and it must keep
    most of its beats on one smooth tempo curve.
    """
    clear_blocks = sum(block.clear for block in blocks)
    if clear_blocks < TRACKER_MIN_KICK_SHARE * len(blocks):
        report.line(f'Beat tracker: not tried. The kick is clear in {clear_blocks} of {len(blocks)} blocks only.')
        return None
    tracked = track_beats(envelopes, about_bpm)
    smoothed = smooth_beats(tracked)
    report_tracking(report, tracked, smoothed)
    if smoothed.kept.mean() < TRACKER_MIN_KEPT_SHARE:
        report.line('The tracker misplaced too many beats to be used.')
        return None
    return extend_beats(smoothed.times, duration_sec)


def tracker_follows_anchors(report: Report, tracked: np.ndarray, anchors: AnchorGrid) -> bool:
    """Returns True when every tracked beat lies near a beat of the window anchors.

    The two methods read different envelopes, so one fixed offset between them is normal and
    is taken out first. A tracker that slips to the pulses between the beats, as it does on a
    song with a pulse at twice the tempo, strays by half a beat and fails this test.
    Only the part of the song that the anchors' curve was fitted to is compared.
    """
    fitted = (tracked >= anchors.fitted_from_sec) & (tracked <= anchors.fitted_to_sec)
    _, distance = nearest_beats(tracked[fitted], anchors.beats)
    stray_sec = float(np.abs(distance - np.median(distance)).max())

    limit_ms = TRACKER_MAX_FROM_ANCHORS_SEC * 1000
    if stray_sec <= TRACKER_MAX_FROM_ANCHORS_SEC:
        report.line(f'The tracked beats stay within {stray_sec * 1000:.0f} ms of the window anchors\' beats '
                    f'(limit {limit_ms:.0f} ms).')
        return True
    report.line(f'The tracked beats stray up to {stray_sec * 1000:.0f} ms from the window anchors\' beats '
                f'(limit {limit_ms:.0f} ms): the tracker slipped to other pulses. Its beats are not used.')
    return False


def tracker_is_closer(report: Report, amplitude: np.ndarray, tracked: np.ndarray, anchored: np.ndarray) -> bool:
    """Returns True when the tracked beats follow the kick better than the window anchors do.

    On Todo Bueno the kick strays 6 ms RMS from the tracked beats and 8 ms from the anchors.
    """
    tracked_blocks, tracked_sec = kick_scatter(amplitude, tracked)
    anchored_blocks, anchored_sec = kick_scatter(amplitude, anchored)
    report.line(f'Kick against the beats, per {KICK_COMPARE_SEC:.0f} s. Tracked beats: {tracked_sec * 1000:.1f} ms RMS '
                f'from its usual place, in {tracked_blocks} blocks with a clear kick. Window anchors: '
                f'{anchored_sec * 1000:.1f} ms, in {anchored_blocks} blocks.')
    return tracked_blocks >= anchored_blocks and tracked_sec < anchored_sec


def find_beat_grid(report: Report, envelopes: Envelopes, amplitude: np.ndarray, tempo: TempoEstimate,
                   duration_sec: float) -> BeatGrid:
    """Returns beat times that cover the whole file, made by the most exact method the song allows.

    One constant grid is the most exact, so it is used whenever the tempo is constant. For a
    tempo that drifts, window anchors follow any percussion, also soft, and the beat tracker
    follows a clear kick more closely. The tracker's beats are used only when they stay near
    the anchors' beats and keep the kick in place better. `amplitude` is the kick band's amplitude.
    Whatever the method, the windows of the song then tell where it holds a clear beat.
    """
    grid = fit_constant_grid(envelopes, duration_sec, tempo.bpm)
    blocks = kick_phase_by_block(envelopes.kick, grid, duration_sec)
    drift_sec = kick_drift_sec(blocks)
    report_grid_test(report, grid, blocks, drift_sec)
    # Soft percussion shows in these two envelopes, with or without a kick.
    percussion = envelopes.percussive + envelopes.full

    if drift_sec is not None and drift_sec <= MAX_KICK_DRIFT_SEC:
        beats, method = grid_beats(grid, duration_sec), 'constant grid'
        clarity = constant_grid_clarity(percussion, grid, duration_sec)
        report.line(f'Method: one constant grid, {grid.bpm:.3f} BPM.')
    else:
        anchors = join_windows(fit_windows(percussion, duration_sec, grid.bpm), duration_sec)
        report_anchors(report, anchors)
        beats, method, clarity = anchors.beats, 'window anchors', anchors.clarity
        tracked = tracker_beats(report, envelopes, blocks, grid.bpm, duration_sec)
        if (tracked is not None and tracker_follows_anchors(report, tracked, anchors)
                and tracker_is_closer(report, amplitude, tracked, anchors.beats)):
            beats, method = tracked, 'tracked beats'
        report.line(f'Method: {method}.')

    clear = find_clear_beat(clarity, duration_sec)
    report_clear_beat(report, clear)
    return BeatGrid(beats=beats, method=method, clear_to_sec=clear.to_sec)


# --- The whole pipeline ---


def given_beat_grid(report: Report, job: Job, duration_sec: float) -> BeatGrid:
    """Returns the beats of --beats as the beat grid, continued to cover the whole file.

    For a song whose beat the tool cannot follow, the beats come from an analysis by hand.
    The tool then fits no grid of its own. The later steps run as usual.
    """
    given = job.given_beats
    if given[-1] >= duration_sec:
        raise SongError(f'{job.given_beats_path} has a beat at {given[-1]:.2f} s, after the end of the audio '
                        f'({duration_sec:.2f} s).')
    tempo = [60 / float(np.mean(np.diff(part))) for part in np.array_split(given, 3)]
    report.section('Beat grid')
    report.line(f'Given: {len(given)} beats from {job.given_beats_path}, from {given[0]:.3f} s to {given[-1]:.3f} s. '
                'The tool fits no grid of its own.')
    report.line(f'Tempo: {tempo[0]:.2f} BPM in the first third, {tempo[1]:.2f} in the middle, {tempo[2]:.2f} in the last.')
    return BeatGrid(beats=extend_beats(given, duration_sec), method='given beats', clear_to_sec=None)


def settle_half_beat(report: Report, envelopes: Envelopes, harmony: tuple[np.ndarray, np.ndarray],
                     beats: np.ndarray, duration_sec: float, choice: str) -> np.ndarray:
    """Returns the beats, or the pulses halfway between them when those carry the bars.

    A fast song with a half-time feel has a pulse at twice the tempo the tool writes. The comb
    can then sit on either half of the pulses. The beats belong where the kick hits and the
    chords change: beats 1 and 3 of the fast bars, not 2 and 4.

    `choice` is 'auto' for the tool's own decision. 'keep' and 'shift' are a decision made by
    hand, for a song where the kick is syncopated and tells nothing: there the snare on beats
    2 and 4 shows the beats, which this step does not read.
    """
    pulses = np.sort(np.concatenate((beats, (beats[:-1] + beats[1:]) / 2)))
    kick = beat_onset_strength(envelopes.kick, pulses)
    change = harmony_change(harmony, pulses)
    kick_on, kick_between = float(kick[0::2].mean()), float(kick[1::2].mean())
    change_on, change_between = float(change[0::2].mean()), float(change[1::2].mean())

    on_share = (kick_on / (kick_on + kick_between) + change_on / (change_on + change_between)) / 2

    report.section('Beats, or the pulses between them')
    report.line(f'Kick hits: {kick_on:.2f} on the beats, {kick_between:.2f} between them. '
                f'Chord and bass changes: {change_on:.2f} on the beats, {change_between:.2f} between them.')
    if choice == 'shift':
        report.line('The beats move by half a beat, onto the pulses between them: the choice was made by hand.')
        return extend_beats(pulses[1::2], duration_sec)
    if choice == 'keep':
        report.line('The beats stay: the choice was made by hand.')
        return beats
    if kick_between > kick_on and change_between > change_on:
        report.line('Both are stronger between the beats: the beats move by half a beat, onto those pulses.')
        return extend_beats(pulses[1::2], duration_sec)
    if on_share < 0.5:
        report.warn('The kick hits and the chord changes do not agree on which pulses are the beats. '
                    'The beats stay. Check the click clips.')
    else:
        report.line(f'The beats stay: they carry {on_share:.0%} of the two together.')
    return beats


def align_to_kick(report: Report, amplitude: np.ndarray, beats: np.ndarray) -> tuple[np.ndarray, list[KickSection]]:
    """Returns the beats moved onto the kick's onset, and the alignment per section after the move."""
    shift_sec = kick_shift_sec(measure_kick(amplitude, beats))
    aligned = beats + (shift_sec or 0.0)
    sections = measure_kick(amplitude, aligned)
    report_kick(report, shift_sec, sections)
    return aligned, sections


def choose_bars(report: Report, job: Job, samples: np.ndarray, harmony: tuple[np.ndarray, np.ndarray],
                envelopes: Envelopes, sounding: np.ndarray) -> int:
    """Returns firstDownbeat for the beats with sound: the tool's choice, or the user's."""
    rises = level_rises(beat_level_db(samples, sounding))
    clues = [start_clue(), rises_clue(rises), chords_clue(harmony, sounding)]
    choice = choose_bar_start(clues)
    report_bars(report, rises, clues, choice, job.first_downbeat, meter_repeat_scores(envelopes, sounding))
    return choice.first_downbeat if job.first_downbeat is None else job.first_downbeat


def report_files(report: Report, manifest_path: Path, audio_path: Path, clips: list[tuple[Path, float]]) -> None:
    """Prints where each written file is."""
    report.section('Files')
    report.line(f'manifest     {manifest_path}')
    report.line(f'audio copy   {audio_path}')
    for clip_path, start_sec in clips:
        report.line(f'check clip   {clip_path}   (song from {start_sec:.0f} s; high click = bar start)')


def report_closing(report: Report, job: Job) -> None:
    """Prints every warning again in one place, then the line that adds the song to the game."""
    report.section(f'Warnings: {len(report.warnings)}')
    for warning in report.warnings:
        report.line(f'- {warning}')

    title = job.title.replace('\\', '\\\\').replace("'", "\\'")
    report.section('Add this line to SONGS in src/game/config.ts:')
    report.line(f"{{ manifest: '{job.manifest_url}', title: '{title}' }},")


def add_song(job: Job, work_dir: Path, report: Report) -> None:
    """Runs the whole analysis for one song and writes its files. Raises SongError on failure."""
    print(f'add-song: "{job.title}" (id {job.song_id}) from {job.source}')

    audio = load_audio(decode_with_ffmpeg(job.source, work_dir))
    chrome = decode_with_chrome(job.source, audio)
    report_decode(report, audio, chrome)

    harmonic, percussive = librosa.effects.hpss(audio.samples)
    envelopes = onset_envelopes(audio.samples, percussive)
    amplitude = kick_amplitude(audio.samples)
    if job.given_beats is None:
        tempo = estimate_tempo(envelopes, audio.duration_sec)
        report_tempo(report, tempo)
        grid = find_beat_grid(report, envelopes, amplitude, tempo, audio.duration_sec)
    else:
        grid = given_beat_grid(report, job, audio.duration_sec)
    harmony = harmony_chroma(audio.samples, harmonic)
    # Given beats stay where they are, unless the user asks for the shift as well.
    half_beat = job.half_beat or ('auto' if job.given_beats is None else 'keep')
    file_beats = settle_half_beat(report, envelopes, harmony, grid.beats, audio.duration_sec, half_beat)
    file_beats, kick_sections = align_to_kick(report, amplitude, file_beats)

    file_onsets = beat_onset_strength(envelopes.full, file_beats)
    span = find_music_span(audio.samples, file_beats, file_onsets, earliest_sec=max(0.0, -chrome.offset_sec))
    sounding = file_beats[span.first:span.last + 1]
    onset_strength = file_onsets[span.first:span.last + 1]
    # The beats are increasing, so the ones before the manifest's end come first.
    before_end = beats_before_end(sounding, chrome)
    past_end = len(sounding) - before_end
    sounding, onset_strength = sounding[:before_end], onset_strength[:before_end]
    clear_beats = clear_beat_count(sounding, grid.clear_to_sec)
    report_music(report, sounding, span, clear_beats)
    if past_end:
        report.line(f'{past_end} beat(s) at the very end lie past the manifest\'s end '
                    f'(durationSec {manifest_duration_sec(chrome)}), so the list leaves them out.')
    if clear_beats is not None:
        sounding, onset_strength = sounding[:clear_beats], onset_strength[:clear_beats]

    first_downbeat = choose_bars(report, job, audio.samples, harmony, envelopes, sounding)
    last, stops_at = last_listed_beat(onset_strength, first_downbeat, music_goes_on=clear_beats is not None)
    if last + 1 - first_downbeat < BEATS_PER_BAR or last + 1 < MIN_BEATS:
        raise SongError(f'firstDownbeat {first_downbeat} leaves too few beats: the list would have {last + 1}.')
    beats = sounding[:last + 1]

    per_bar = bar_intensity(beat_level_db(audio.samples, beats),
                            percussive_density(envelopes.percussive, beats), first_downbeat)
    if job.pacing == 'rank':
        per_bar = pace_by_rank(per_bar)
    manifest = build_manifest(job, beats, beat_intensity(per_bar, len(beats), first_downbeat),
                              first_downbeat, chrome)
    report_beats(report, manifest, grid.method, stops_at)
    report_intensity(report, per_bar, job.pacing)
    manifest = with_short_start(manifest, short_start_sec(report, job, manifest))
    check_manifest(manifest)

    # For --keep-work: the envelopes and beat times, in ffmpeg's decode, to look at by hand.
    np.savez(work_dir / 'analysis.npz', full=envelopes.full, percussive=envelopes.percussive,
             kick=envelopes.kick, file_beats=file_beats, beats=beats)
    clips = write_clips(job, work_dir, audio.samples, beats, first_downbeat, kick_sections)
    audio_path, manifest_path = write_manifest(job, manifest)
    report_files(report, manifest_path, audio_path, clips)
    if job.reference is not None:
        report_comparison(report, manifest, job.reference, job.reference_path)
    report_closing(report, job)


def main(argv: list[str]) -> int:
    """Runs the tool. Returns the exit code: 0 when the manifest was written, 1 on a SongError."""
    work_dir: Path | None = None
    keep_work = False
    # Line by line also through a pipe, so progress shows and an error never overtakes the report.
    sys.stdout.reconfigure(line_buffering=True)
    try:
        job = plan_job(parse_arguments(argv))
        keep_work = job.keep_work
        work_dir = Path(tempfile.mkdtemp(prefix='add-song-'))
        add_song(job, work_dir, Report())
        return 0
    except SongError as error:
        print(f'\nadd-song: error: {error}', file=sys.stderr)
        return 1
    finally:
        if work_dir and keep_work:
            print(f'\nIntermediate files kept in {work_dir}')
        elif work_dir:
            shutil.rmtree(work_dir, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
