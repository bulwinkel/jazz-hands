import type { FaceExpression, GestureName, TrackerMode, TrackingThread } from '../tracking/types';
import type { Level, PlayerCount } from './types';

/**
 * Where the camera is tracked when the URL does not say: the main thread, for now.
 * `?thread=worker` moves the trackers into the tracking workers, where the picture stays
 * smooth while tracking is busy: 60 drawn frames per second, against about 30 with two players.
 * The tracking workers gave the same hands as the main thread on a test video. They become the
 * default when a recording of real players has shown the same.
 */
export const DEFAULT_TRACKING_THREAD: TrackingThread = 'main';

/**
 * Two players each own half the frame, and split tracking gives each half twice the resolution.
 * One player stands in the centre, across the line where split tracking cuts the frame,
 * so one player gets the full-frame tracker.
 */
export const DEFAULT_TRACKER: Record<PlayerCount, TrackerMode> = {
  1: 'hands-full',
  2: 'hands-split',
};

/** The menu tracks hands over the whole frame: a player may stand anywhere to point at it. */
export const MENU_TRACKER: TrackerMode = 'hands-full';

/** Choosing menu items by hand: an open hand highlights an item, a fist held on it chooses it. */
export const HAND_MENU = {
  /** How long the fist must hold. Short, because a fist is a deliberate act. */
  holdSec: 0.5,
  /** Items that start or leave a round take a little longer. */
  slowHoldSec: 0.8,
  /** Hands below this height in the frame (0 = top, 1 = bottom) are resting, not pointing. */
  lowestY: 0.9,
} as const;

export interface SongEntry {
  /** Path of the song's manifest, which the song tool writes. */
  manifest: string;
  title: string;
  /** Path of the cover picture, a square. A song with no picture shows its title on a plain cover. */
  cover?: string;
}

/** Add a song with one entry here. The menu shows the songs in this order. */
export const SONGS: readonly SongEntry[] = [
  {
    manifest: '/songs/blessed-on-the-hillside.json',
    title: 'Blessed on the Hillside',
    cover: '/songs/blessed-on-the-hillside.jpg',
  },
  {
    manifest: '/songs/todo-bueno.json',
    title: 'Todo Bueno',
    cover: '/songs/todo-bueno.jpg',
  },
  {
    manifest: '/songs/from-the-garden-to-the-cross.json',
    title: 'From the Garden to the Cross',
    cover: '/songs/from-the-garden-to-the-cross.jpg',
  },
  {
    manifest: '/songs/drum-and-bass-violins.json',
    title: 'Drum and Bass Violins',
    cover: '/songs/drum-and-bass-violins.jpg',
  },
  {
    manifest: '/songs/all-eyes-on-us.json',
    title: 'All Eyes on Us',
    cover: '/songs/all-eyes-on-us.jpg',
  },
  {
    manifest: '/songs/return-to-the-lord.json',
    title: 'Return to the Lord',
    cover: '/songs/return-to-the-lord.jpg',
  },
  {
    manifest: '/songs/the-wilderness-knows.json',
    title: 'The Wilderness Knows',
    cover: '/songs/the-wilderness-knows.jpg',
  },
  {
    manifest: '/songs/job-hold-on.json',
    title: 'Job, Hold On',
    cover: '/songs/job-hold-on.jpg',
  },
  {
    manifest: '/songs/all-aboard.json',
    title: 'All Aboard',
    cover: '/songs/all-aboard.jpg',
  },
  {
    manifest: '/songs/nebuchadnezzars-dream.json',
    title: "Nebuchadnezzar's Dream",
    cover: '/songs/nebuchadnezzars-dream.jpg',
  },
  {
    manifest: '/songs/the-valley-waits.json',
    title: 'The Valley Waits',
    cover: '/songs/the-valley-waits.jpg',
  },
  {
    manifest: '/songs/part-the-sea.json',
    title: 'Part the Sea',
    cover: '/songs/part-the-sea.jpg',
  },
  {
    manifest: '/songs/hey-ho-jonah.json',
    title: 'Hey-Ho, Jonah',
    cover: '/songs/hey-ho-jonah.jpg',
  },
  {
    manifest: '/songs/josephs-coat-of-many-colors.json',
    title: "Joseph's Coat of Many Colors",
    cover: '/songs/josephs-coat-of-many-colors.jpg',
  },
  {
    manifest: '/songs/jericho-fell.json',
    title: 'Jericho Fell',
    cover: '/songs/jericho-fell.jpg',
  },
  {
    manifest: '/songs/build-your-house-upon-the-rock.json',
    title: 'Build Your House Upon the Rock',
    cover: '/songs/build-your-house-upon-the-rock.jpg',
  },
  {
    manifest: '/songs/a-feast-for-all.json',
    title: 'A Feast for All',
    cover: '/songs/a-feast-for-all.jpg',
  },
  {
    manifest: '/songs/peace-be-still.json',
    title: 'Peace, Be Still',
    cover: '/songs/peace-be-still.jpg',
  },
  {
    manifest: '/songs/zaqueo.json',
    title: 'Zaqueo',
    cover: '/songs/zaqueo.jpg',
  },
  {
    manifest: '/songs/for-such-a-time-as-this.json',
    title: 'For Such a Time as This',
    cover: '/songs/for-such-a-time-as-this.jpg',
  },
];

/** The part of a song that plays in the menu while the song is chosen. */
export const PREVIEW = {
  /** The part is this long. Then it starts again. */
  lengthSec: 20,
  fadeInSec: 0.5,
  fadeOutSec: 1.5,
  /** A preview fades out this fast when the player picks another song or starts the round. */
  stopFadeSec: 0.25,
  /** Share of full volume. Quieter than the round's music, so players can talk over the menu. */
  volume: 0.6,
  /**
   * A newly chosen song waits this long before it plays, so a step past a song stays quiet.
   * Longer than HAND_MENU.holdSec: a fist held on "next song" then steps on in silence.
   */
  waitSec: 0.7,
} as const;

/**
 * The seed that the candidate seeds of the cue sets count from, and the seed of the tests.
 * Before cue sets, every round played the chart from this seed. It was picked from 400
 * candidates when the game had two songs: its charts for both, at levels 3 and 4, came
 * closest to the shares of slides and doubles that the level rules asked for then. A random
 * seed could be off by 15 points. The rolls and the chances have changed since, so that choice
 * says nothing about the charts of today. The cue sets now choose the seed of each round.
 */
export const DEFAULT_SEED = 20261315;

/**
 * Cue sets give one song other charts at the same difficulty, and differ by their share of
 * moves. Every set tries a few candidate seeds and keeps the one whose charts come closest to
 * the typical mix of the level on this song: its slides, doubles, off-beat taps and number of
 * cues. See cueSet.ts.
 */
export const CUE_SETS = {
  /**
   * The share of phrases in busy music that hold a move, for each set: set k plays with entry
   * k − 1. The sets are numbered from 1 to the length of this list. Two sets for each share
   * let players compare two charts of each kind and rate the shares.
   */
  moveShares: [0, 0, 0.35, 0.35, 0.7, 0.7],
  /**
   * Seeds that each set tries. The candidates of all sets together are the pool that gives
   * the typical mix, so a round start makes (sets × candidates) charts per player: about
   * 0.15 s for two players and the longest song. More candidates find a closer match, and
   * take longer.
   */
  candidates: 24,
  /**
   * Set k tries the seeds from DEFAULT_SEED + k × this spacing on. The spacing is larger than
   * the count of candidates, so no two sets share a seed.
   */
  candidateSpacing: 1000,
  /**
   * How much each part of the mix counts in a candidate's distance from the typical mix. A
   * share counts in points; the number of cues counts by its relative change, so 1% more
   * cues is like 1 point. Off-beat taps and the number of cues both say how busy a chart is:
   * each counts half, so that counts once. The weights were chosen by measuring the 15 songs
   * at levels 3 to 5, at both lengths, when the mix also held a share of fast slides.
   */
  weights: { slides: 1, doubles: 1, offbeats: 0.5, cues: 0.5 },
} as const;

/** Milliseconds around a cue's due time, as [early, late]. Early is negative. */
export type WindowMs = readonly [number, number];

export interface LevelRules {
  name: string;
  /** Cues come at the fast interval where the music reaches this intensity. */
  fastFromIntensity: number;
  /** Cues thin out to every second stride below this intensity. */
  sparseBelowIntensity: number;
  /** Share of busy cue beats that need two hands at once. */
  doubleChance: number;
  doublesOnBarStartsOnly: boolean;
  /**
   * Share of busy cue beats that start a slide, where one fits: three taps in a line, one on
   * each of three cue beats in a row. See `slideFits` in chart.ts.
   */
  slideChance: number;
  /**
   * Share of busy single taps that are followed by an extra tap halfway to the next cue beat.
   * A double is never followed by one: it leaves no hand free.
   */
  offbeatChance: number;
  /**
   * With the hand shapes switch on, the roll that gives a single tap a shape also gives shapes
   * to a tap for two hands and to a slide: two different shapes for the two hands, and a
   * pattern over the three cells of a slide. See shapePatterns.ts.
   */
  shapesOnDoublesAndSlides: boolean;
  /**
   * Every cue asks for a hand shape. In a steady phrase one shape lasts a few seconds, then it
   * changes. In a shuffle phrase the shape changes from cue to cue, by a pattern.
   */
  shapeOnEveryCue: boolean;
  /** How long a cue is on screen before it is due. */
  approachSec: number;
  perfectMs: WindowMs;
  goodMs: WindowMs;
}

export const LEVELS: Record<Level, LevelRules> = {
  1: {
    name: 'Slow',
    fastFromIntensity: Infinity,
    sparseBelowIntensity: 0.35,
    doubleChance: 0,
    doublesOnBarStartsOnly: false,
    slideChance: 0,
    offbeatChance: 0,
    shapesOnDoublesAndSlides: false,
    shapeOnEveryCue: false,
    approachSec: 1.4,
    perfectMs: [-150, 200],
    goodMs: [-350, 450],
  },
  2: {
    name: 'Every beat',
    fastFromIntensity: 0.5,
    sparseBelowIntensity: 0,
    doubleChance: 0.3,
    doublesOnBarStartsOnly: true,
    slideChance: 0,
    offbeatChance: 0,
    shapesOnDoublesAndSlides: false,
    shapeOnEveryCue: false,
    approachSec: 1,
    perfectMs: [-120, 160],
    goodMs: [-280, 350],
  },
  3: {
    name: 'Two hands + slides',
    fastFromIntensity: 0.35,
    sparseBelowIntensity: 0,
    doubleChance: 0.45,
    doublesOnBarStartsOnly: false,
    // A slide takes three cue beats. This chance gives about as many slides as 0.22 gave the
    // slides of two and three cells before: 91336 against 92279, over every song at its full
    // length and every candidate seed of the cue sets.
    slideChance: 0.28,
    offbeatChance: 0,
    shapesOnDoublesAndSlides: false,
    shapeOnEveryCue: false,
    approachSec: 1,
    perfectMs: [-120, 160],
    goodMs: [-280, 350],
  },
  4: {
    name: 'Fast hands',
    fastFromIntensity: 0.35,
    sparseBelowIntensity: 0,
    doubleChance: 0.4,
    doublesOnBarStartsOnly: false,
    // Tuned as level 3: 76862 slides against 77647 with the fast, normal and slow slides of 0.3.
    slideChance: 0.35,
    offbeatChance: 0.6,
    shapesOnDoublesAndSlides: true,
    shapeOnEveryCue: false,
    approachSec: 1,
    perfectMs: [-120, 160],
    goodMs: [-280, 350],
  },
  5: {
    name: 'All signs',
    fastFromIntensity: 0.35,
    sparseBelowIntensity: 0,
    doubleChance: 0.4,
    doublesOnBarStartsOnly: false,
    // The slides of level 4: a shape does not change the chart.
    slideChance: 0.35,
    offbeatChance: 0.6,
    // Off: every cue asks for a shape of its own at this level. See shapeOnEveryCue.
    shapesOnDoublesAndSlides: false,
    shapeOnEveryCue: true,
    approachSec: 1,
    perfectMs: [-120, 160],
    goodMs: [-280, 350],
  },
};

export const CHART = {
  /** A beat's cell differs from the cells of this many beats before it. */
  recentCells: 4,
  /** Choice weight per cell. The top row is favoured. The centre is rare: it covers the face. */
  cellWeights: [1.2, 1.2, 1.2, 1, 0.4, 1, 0.7, 0.7, 0.7],
  /** No cues before this many bars, and this many seconds, have passed. */
  leadBars: 2,
  leadSec: 4,
  /** No cues in this many bars before the end. */
  tailBars: 1,
  /** Cues sit on every 1st, 2nd, 4th or 8th beat: the smallest that keeps the minimum interval. */
  strides: [1, 2, 4, 8],
  slowIntervalSec: 1.1,
  fastIntervalSec: 0.55,
  /** Doubles and slides appear only where the music is at least this intense. */
  busyIntensity: 0.5,
  /** Share of single taps that ask for a hand shape, when a player switches shapes on. */
  gestureChance: 0.35,
  /** A hand needs this long after the previous cue to change shape. */
  gestureGapSec: 0.55,
  /**
   * A hand needs this long to travel from one target to the next. The chart never asks a
   * player's two hands for more: a cue that would is made smaller or left out.
   */
  handRestSec: 0.45,
  gesturePool: ['fist', 'open', 'point', 'peace'] satisfies GestureName[],
  /**
   * A pattern of hand shapes is a pair (A B A B) with this chance, else a triple (A B C A B C).
   * A pair is the usual one: it is easier to read and to remember. See shapePatterns.ts.
   */
  patternPairShare: 0.7,
  /**
   * At a level with a shape on every cue, one shape lasts at least this long, and changes on
   * a bar start. A player holds the shape through a run of cues and changes it with the music.
   */
  shapePhraseSec: 4,
  /**
   * At a level with a shape on every cue, a phrase in busy music whose mean intensity reaches a
   * threshold is a shuffle phrase: its shape changes from cue to cue, by a pattern. The
   * threshold falls in a straight line, from this value at the round's first cue to
   * `shuffleIntensityTo` at its end, so shuffles come more often late in the song. Tuned on the
   * 20 songs: every Short round gets 2 or 3 shuffle phrases, and a Full round gets a shuffle in
   * a median of 24% of its phrases. See shapePatterns.ts.
   */
  shuffleIntensityFrom: 0.66,
  /** The threshold of a shuffle phrase at the end of the round: busy music is enough. */
  shuffleIntensityTo: 0.5,
  /** The first whole phrases of a round are never shuffle phrases: players first find the beat. */
  steadyOpeningPhrases: 2,
  /**
   * No phrase that starts less than this many seconds after the round's first cue is a shuffle
   * phrase. Two whole phrases of a fast song last only about 11 s.
   */
  firstShuffleAfterSec: 20,
  /** After a shuffle phrase, at least this many steady phrases follow: a rest between two shuffles. */
  steadyPhrasesAfterShuffle: 2,
  /**
   * In a shuffle phrase, the pattern steps at every cue when the cues are at least this far
   * apart, and at every second cue when they are closer: a hand needs time to change shape.
   */
  patternStepSec: 0.7,
} as const;

/**
 * Disco moves: named patterns of cues that take the place of the random cues for part of a
 * phrase. The moves themselves are in moves.ts.
 */
export const MOVES = {
  /** A phrase is this many bars. A move starts on the first beat of a phrase and ends inside it. */
  phraseBars: 4,
} as const;

/** Face cues, for a player who switches faces on. They do not depend on the level. */
export const FACES = {
  /**
   * Face cues are at least this many seconds apart. A cue sits on a bar start, on every Nth
   * bar, where N is the smallest count of bars that lasts this long. A count of bars alone
   * would crowd a fast song: 2 bars are 5 s at 95 BPM and under 3 s at 180 BPM.
   */
  minGapSec: 5,
  /** No face cue where the music is quieter than this. */
  minIntensity: 0.35,
  /** The expressions a cue can ask for. A cue never asks for the same one as the cue before it. */
  pool: ['smile', 'openMouth', 'pucker'] satisfies FaceExpression[],
  /**
   * A face shows an expression when the tracker reads at least this strength, 0..1.
   * Set from four real rounds (160 face cues, two players): a made expression peaked at about
   * 0.7 for a smile and 0.95 for a pucker, and an adult's open mouth at only 0.2 to 0.45.
   * Faces that were not made read under 0.1. The values sit between the two groups.
   */
  thresholds: { smile: 0.4, openMouth: 0.25, pucker: 0.35 } satisfies Record<FaceExpression, number>,
  /** The tracker looks for a face in a box this many cells wide, centred on the grid. */
  regionCells: 2,
  /**
   * The box starts this many cell heights above the grid top. A player who kept both hands
   * low in the reach fit has a grid whose top is below their face.
   */
  regionAboveCells: 0.5,
  /** The box ends this share of the grid height below the grid top. */
  regionHeight: 0.6,
  /**
   * Before play, the tracker must find a player's face in this many frames, or the round drops
   * that player's face cues. One frame can be luck: on an iPad the tracker found a face in 1
   * frame of 162, and every face cue then gave no result.
   */
  sightingsToKeep: 10,
} as const;

export const GRID = {
  /** A hand counts as inside a cell this far beyond its edge, as a share of the cell size. */
  cellMargin: 0.12,
  /** The standard grid, before a player's first calibration that counts, as shares of the frame. */
  duoWidth: 0.42,
  soloWidth: 0.56,
  defaultTop: 0.1,
  defaultHeight: 0.8,
  /** The reach fit ignores the outermost 2% of hand positions on each side. */
  fitPercentiles: [0.02, 0.98],
  /**
   * With fewer hand positions than this, the grid on screen stays the standard grid while a
   * player draws, and the calibration does not count.
   */
  fitMinSamples: 20,
  /** The smallest grid. A calibration whose reach is smaller than this does not count. */
  minWidth: 0.18,
  minHeight: 0.3,
  /** Gap between a grid and the edge of its player's area. */
  edgeMargin: 0.01,
} as const;

/** The cell a player holds a hand in to start a round, and to play again on the results: top-right. */
export const START_CELL = 2;

/**
 * The cell a player holds a hand in on the ready screen to calibrate: top-left. It is the
 * second choice, so it sits apart from the Start cell, with the top-middle cell between them.
 */
export const CALIBRATE_CELL = 0;

/** What the Start cell and the Calibrate cell show on the ready screen: a sign, and a word under it. */
export const HOLD_CELL_LABELS = {
  start: { sign: '✋', word: 'Start' },
  calibrate: { sign: '📏', word: 'Calibrate' },
} as const;

export const TIMING = {
  /** Camera and tracking delay, taken off every tracking frame's time. Tuned with [ and ]. */
  inputLatencyMs: 100,
  /** A kept camera delay is clamped into this range on load, as [lowest, highest]. */
  inputLatencyRangeMs: [-1000, 2000],
  /** Extra delay between sound and picture. Tuned with , and . */
  avOffsetMs: 0,
  /** A kept picture offset is clamped into this range on load, as [lowest, highest]. */
  avOffsetRangeMs: [-2000, 2000],
  /** The Short length ends at the first bar start this long after its start. */
  shortSec: 90,
  fadeSec: 2,
  /** A round that starts inside the song fades in, so the music does not jump in. */
  fadeInSec: 0.3,
  /** Time to get from the laptop to the play spot before a calibration that a key or a click began. */
  walkBackSec: 8,
  fitSec: 6,
  /**
   * After a calibration begun by hand, hands count only after this long. The hand that held
   * the Calibrate cell, or the fist that chose Recalibrate on the results, is still there, and
   * its positions would pull a grid toward it.
   */
  handSettleSec: 1,
  /** A hand held this long in the Start cell starts the round. */
  readyHoldSec: 1,
  /** A hand held this long in the Start cell on the results plays again. */
  replayHoldSec: 1.5,
  /** A hand held this long in the Calibrate cell calibrates its player. Longer than the start: it is the second choice. */
  calibrateHoldSec: 1.5,
  countdownSec: 3,
  feedbackSec: 0.6,
  /** A tracking frame older than this is stale: hands are hidden and holds reset. */
  staleFrameMs: 500,
} as const;

/**
 * The timing mark of a cue, a block, starts at this share of its cell. Small, but large
 * enough to see. See cueMark.ts.
 */
export const GROW_START_SCALE = 0.15;

/**
 * Recording a round as video: the game view, with the grids, the cues and the score, and the
 * camera view. See recording.ts.
 */
export const RECORDING = {
  /** The game view is this high. Its width follows the camera's shape. */
  gameHeight: 720,
  frameRate: 30,
  /**
   * A display frame this close before a frame of the game view is due still draws it, so
   * screen jitter skips none.
   */
  frameSlackMs: 4,
  gameBitsPerSec: 4_000_000,
  /** The camera view keeps the camera's own size, 1080p on a recent laptop. */
  cameraBitsPerSec: 6_000_000,
  audioBitsPerSec: 128_000,
  /**
   * Room for the speakers' own delay in a recording's sound, on top of the largest offsets the
   * settings allow. Bluetooth speakers add about 0.3 s.
   */
  outputLatencyRoomSec: 1,
  /** The recording goes on this long after the results show: the cheer, and the result card. */
  tailSec: 4,
  /**
   * A video's sound is late by its delay, so the end of the song reaches the video that much
   * after the results show. The recording then goes on for the delay and this margin at least.
   */
  soundTailMarginSec: 0.5,
} as const;

/** Notes at the top of the screen. */
export const TOAST = {
  /** A short note stays this long, when the code that shows it gives no time of its own. */
  shortMs: 1600,
  /** A note to read from the dance spot, such as "hand control stopped", stays this long. */
  longMs: 6000,
} as const;

/** The test bot holds each cue cell from `leadSec` before its due time until `holdSec` after. */
export const BOT = {
  leadSec: 0.3,
  holdSec: 0.2,
} as const;

export const PLAYER_COLORS = ['#22d3ee', '#e879f9'] as const;

/**
 * The pictures must be easy to tell apart from across a room. In real rounds, players often
 * puckered for the plain open-mouth face and the other way round: both showed a small round
 * mouth. So the smile shows teeth, the open mouth is wide, and the pucker carries a heart.
 */
export const FACE_EMOJI: Record<FaceExpression, string> = {
  smile: '😁',
  openMouth: '😲',
  pucker: '😘',
};

export const GESTURE_EMOJI: Partial<Record<GestureName, string>> = {
  fist: '✊',
  open: '✋',
  point: '☝️',
  peace: '✌️',
  thumbsUp: '👍',
  thumbsDown: '👎',
  rock: '🤘',
};
