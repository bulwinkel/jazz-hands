import type { GestureName } from '../tracking/types';
import { MAX_ZONES } from '../tracking/zoneGeometry';
import type { ZoneLayout, ZoneModel } from '../tracking/zones';

/** One way to track the zones. The test measures every one of them. */
export interface Variant {
  layout: ZoneLayout;
  model: ZoneModel;
}

export const VARIANTS: readonly Variant[] = [
  { layout: 'full', model: 'gesture' },
  { layout: 'full', model: 'landmarks' },
  { layout: 'crops', model: 'gesture' },
  { layout: 'crops', model: 'landmarks' },
];

/** One thing the person does with their hands while the tracker is measured. */
export interface TestPhase {
  /** Shown in very large text, and said aloud. */
  instruction: string;
  /** The hand shape the person makes. Null when the phase asks for no shape. */
  expectedShape: GestureName | null;
}

export const PHASES: readonly TestPhase[] = [
  { instruction: 'HANDS BEHIND YOUR BACK', expectedShape: null },
  { instruction: 'OPEN HANDS, up high', expectedShape: 'open' },
  // Hip height is the bottom row of a grid: the hardest place for the tracker.
  { instruction: 'FISTS, down low', expectedShape: 'fist' },
  { instruction: 'PEACE SIGNS, out wide', expectedShape: 'peace' },
  { instruction: 'WAVE both hands fast', expectedShape: null },
];

/**
 * The two phases the cost estimates are made from. With no hand in view a model runs its
 * detector and nothing else. With open hands held still it also follows those hands.
 */
export const HANDS_HIDDEN_PHASE = 0;
export const HANDS_SHOWN_PHASE = 1;

export interface Timing {
  /** Time to walk back from the laptop before the first phase. */
  countdownMs: number;
  /** Time to take up the pose of a phase. Not recorded. */
  readyMs: number;
  recordMs: number;
}

export const TIMING: Timing = { countdownMs: 10_000, readyMs: 2_000, recordMs: 5_000 };

/** `?quick=1`: a run for automated checks. It is too short to measure anything. */
export const QUICK_TIMING: Timing = { countdownMs: 1_000, readyMs: 1_000, recordMs: 1_000 };

export const DEFAULT_ZONES = 3;

/** A zone counts as having a person when a hand was seen there in more than this share of frames. */
export const OCCUPIED_SHARE = 0.5;

/** The camera's frame rate when the browser does not report one. */
export const ASSUMED_CAMERA_FPS = 30;

/** One colour for each zone, bright enough to read on a camera picture from across a room. */
export const ZONE_COLORS: readonly string[] = ['#22d3ee', '#f472b6', '#fde047', '#86efac'];

export interface PageOptions {
  zones: number;
  /** A short run for automated checks. */
  quick: boolean;
  /** No voice and no beeps. */
  silent: boolean;
}

/**
 * URL parameters, all optional:
 *   zones=1..4   quick=1   silent=1
 *
 * A quick run is always silent. Only a machine starts one, and its voice would talk into the
 * room where people are.
 */
export function parseOptions(query: string): PageOptions {
  const params = new URLSearchParams(query);
  const zones = Number(params.get('zones'));
  const isZoneCount = Number.isInteger(zones) && zones >= 1 && zones <= MAX_ZONES;
  const quick = params.get('quick') === '1';
  return {
    zones: isZoneCount ? zones : DEFAULT_ZONES,
    quick,
    silent: quick || params.get('silent') === '1',
  };
}
