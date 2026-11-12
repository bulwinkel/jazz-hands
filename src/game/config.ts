import type { FaceExpression, GestureName, TrackerMode } from '../tracking/types';
import type { Level, PlayerCount, SlideSpeed } from './types';

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

/** Add a song with one line here. */
export const SONGS = [
  { manifest: '/songs/blessed-on-the-hillside.json', title: 'Blessed on the Hillside' },
  { manifest: '/songs/todo-bueno.json', title: 'Todo Bueno' },
  { manifest: '/songs/from-the-garden-to-the-cross.json', title: 'From the Garden to the Cross' },
  { manifest: '/songs/drum-and-bass-violins.json', title: 'Drum and Bass Violins' },
  { manifest: '/songs/all-eyes-on-us.json', title: 'All Eyes on Us' },
  { manifest: '/songs/return-to-the-lord.json', title: 'Return to the Lord' },
] as const;

/**
 * The chart is the same every run unless the URL gives another seed.
 * This seed was picked from 400 candidates: its charts for both songs, at levels 3 and 4,
 * come closest to the shares of slides and doubles that the level rules ask for.
 * A random seed can be off by 15 points, which makes a level feel unlike its rules.
 */
export const DEFAULT_SEED = 20261315;

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
  /** Share of busy cue beats that start a slide. */
  slideChance: number;
  /** How the slides split by speed. The three shares add up to 1. */
  slideSpeeds: Record<SlideSpeed, number>;
  /**
   * Share of busy single taps that are followed by an extra tap halfway to the next cue beat.
   * A double is never followed by one: it leaves no hand free.
   */
  offbeatChance: number;
  /** Share of slow slides during which the other hand gets a tap, on the slide's middle beat. */
  companionTapChance: number;
  /** Every cue asks for a hand shape. One shape lasts a few seconds, then it changes. */
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
    slideSpeeds: { fast: 0, normal: 1, slow: 0 },
    offbeatChance: 0,
    companionTapChance: 0,
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
    slideSpeeds: { fast: 0, normal: 1, slow: 0 },
    offbeatChance: 0,
    companionTapChance: 0,
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
    slideChance: 0.22,
    slideSpeeds: { fast: 0, normal: 0.7, slow: 0.3 },
    offbeatChance: 0,
    companionTapChance: 0,
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
    slideChance: 0.3,
    slideSpeeds: { fast: 0.3, normal: 0.25, slow: 0.45 },
    offbeatChance: 0.6,
    companionTapChance: 0.8,
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
    slideChance: 0.3,
    slideSpeeds: { fast: 0.3, normal: 0.25, slow: 0.45 },
    offbeatChance: 0.6,
    companionTapChance: 0.8,
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
   * The two ends of a fast slide are one continuous move, so they are exempt.
   */
  handRestSec: 0.45,
  gesturePool: ['fist', 'open', 'point', 'peace'] satisfies GestureName[],
  /**
   * At a level with a shape on every cue, one shape lasts at least this long, and changes on
   * a bar start. A player holds the shape through a run of cues and changes it with the music.
   */
  shapePhraseSec: 4,
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
  /** A face shows an expression when the tracker reads at least this strength, 0..1. */
  thresholds: { smile: 0.5, openMouth: 0.4, pucker: 0.5 } satisfies Record<FaceExpression, number>,
  /** The tracker looks for a face in a box this many cells wide, centred on the grid. */
  regionCells: 2,
  /**
   * The box starts this many cell heights above the grid top. A player who kept both hands
   * low in the reach fit has a grid whose top is below their face.
   */
  regionAboveCells: 0.5,
  /** The box ends this share of the grid height below the grid top. */
  regionHeight: 0.6,
} as const;

export const GRID = {
  /** A hand counts as inside a cell this far beyond its edge, as a share of the cell size. */
  cellMargin: 0.12,
  /** Grid before the reach fit, as shares of the frame. */
  duoWidth: 0.42,
  soloWidth: 0.56,
  defaultTop: 0.1,
  defaultHeight: 0.8,
  /** The reach fit ignores the outermost 2% of hand positions on each side. */
  fitPercentiles: [0.02, 0.98],
  /** With fewer hand positions than this, the fit keeps the default grid. */
  fitMinSamples: 20,
  minWidth: 0.18,
  minHeight: 0.3,
  /** Gap between a grid and the edge of its player's area. */
  edgeMargin: 0.01,
} as const;

/** The cell a player holds a hand in to start and to replay: top-middle. */
export const HANDS_UP_CELL = 1;

export const TIMING = {
  /** Camera and tracking delay, taken off every tracking frame's time. Tuned with [ and ]. */
  inputLatencyMs: 100,
  /** Extra delay between sound and picture. Tuned with , and . */
  avOffsetMs: 0,
  /** The Short length ends at the first bar start this long after its start. */
  shortSec: 90,
  fadeSec: 2,
  /** A round that starts inside the song fades in, so the music does not jump in. */
  fadeInSec: 0.3,
  /** Time to get from the laptop to the play spot before the reach fit. */
  walkBackSec: 8,
  fitSec: 6,
  readyHoldSec: 1,
  replayHoldSec: 1.5,
  countdownSec: 3,
  feedbackSec: 0.6,
  /** A tracking frame older than this is stale: hands are hidden and holds reset. */
  staleFrameMs: 500,
} as const;

/** The test bot holds each cue cell from `leadSec` before its due time until `holdSec` after. */
export const BOT = {
  leadSec: 0.3,
  holdSec: 0.2,
} as const;

export const PLAYER_COLORS = ['#22d3ee', '#e879f9'] as const;

export const FACE_EMOJI: Record<FaceExpression, string> = {
  smile: '😀',
  openMouth: '😮',
  pucker: '😗',
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
