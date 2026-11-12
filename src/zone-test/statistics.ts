import type { GestureName } from '../tracking/types';
import type { ZoneFrame } from '../tracking/zones';

/** What the tracker showed in one zone during one phase. */
export interface ZoneSummary {
  /** Share of frames with no hand, with one hand and with two hands in the zone. */
  noHands: number;
  oneHand: number;
  twoHands: number;
  /** Mean size of the hands seen: the bounding-box diagonal as a share of the frame height. */
  meanHandSize: number | null;
  /**
   * Share of the hands seen whose finger-read shape was the one the phase asks for.
   * Null when the phase asks for no shape, or when no hand was seen.
   */
  shapeMatch: number | null;
  /** The same for MediaPipe's own label. Null also for the landmark model, which gives no label. */
  modelLabelMatch: number | null;
  /**
   * `crops` only: the mean time this zone took for its crop and its model, on the frames where
   * it showed no hand, one hand and two hands. Null when it never showed that many.
   */
  inferenceMs?: { noHands: number | null; oneHand: number | null; twoHands: number | null };
}

/** What the tracker did during the recorded seconds of one phase. */
export interface PhaseSummary {
  frames: number;
  framesPerSec: number;
  /** The time one frame took, for every model and crop together. */
  inferenceMs: { mean: number | null; p95: number | null };
  /** Mean hands seen in a frame, over all zones. */
  meanHands: number | null;
  zones: ZoneSummary[];
}

export function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** The value that `fraction` of the values lie at or below (nearest rank). */
export function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank - 1))];
}

function roundedMean(values: readonly number[], digits: number): number | null {
  const value = mean(values);
  return value === null ? null : round(value, digits);
}

function share(count: number, total: number): number {
  return total === 0 ? 0 : round(count / total, 3);
}

/** Share of the readings that are the expected shape. Null with nothing to compare. */
function matchShare(readings: readonly GestureName[], expected: GestureName | null): number | null {
  if (expected === null || readings.length === 0) return null;
  return share(readings.filter((reading) => reading === expected).length, readings.length);
}

/** The time one zone took on the frames where it showed `handCount` hands. */
function zoneTimesWith(frames: readonly ZoneFrame[], zone: number, handCount: number): number[] {
  return frames
    .filter((frame) => frame.zones[zone].length === handCount)
    .map((frame) => frame.zoneInferenceMs?.[zone])
    .filter((time) => time !== undefined);
}

function summariseZone(
  frames: readonly ZoneFrame[],
  zone: number,
  expectedShape: GestureName | null,
): ZoneSummary {
  const hands = frames.flatMap((frame) => frame.zones[zone]);
  const framesWith = (handCount: number): number =>
    frames.filter((frame) => frame.zones[zone].length === handCount).length;
  const modelLabels = hands.map((hand) => hand.modelGesture).filter((label) => label !== undefined);

  const summary: ZoneSummary = {
    noHands: share(framesWith(0), frames.length),
    oneHand: share(framesWith(1), frames.length),
    twoHands: share(framesWith(2), frames.length),
    meanHandSize: roundedMean(hands.map((hand) => hand.size), 4),
    shapeMatch: matchShare(hands.map((hand) => hand.gesture), expectedShape),
    modelLabelMatch: matchShare(modelLabels, expectedShape),
  };
  const timedPerZone = frames.some((frame) => frame.zoneInferenceMs !== undefined);
  if (timedPerZone) {
    summary.inferenceMs = {
      noHands: roundedMean(zoneTimesWith(frames, zone, 0), 2),
      oneHand: roundedMean(zoneTimesWith(frames, zone, 1), 2),
      twoHands: roundedMean(zoneTimesWith(frames, zone, 2), 2),
    };
  }
  return summary;
}

/** Sums up the frames recorded in one phase. `recordMs` is how long the recording lasted. */
export function summarisePhase(
  frames: readonly ZoneFrame[],
  zones: number,
  recordMs: number,
  expectedShape: GestureName | null,
): PhaseSummary {
  const frameTimes = frames.map((frame) => frame.inferenceMs);
  const handsInFrame = frames.map((frame) => frame.zones.reduce((sum, hands) => sum + hands.length, 0));
  const p95 = percentile(frameTimes, 0.95);

  return {
    frames: frames.length,
    framesPerSec: round(frames.length / (recordMs / 1000), 1),
    inferenceMs: { mean: roundedMean(frameTimes, 2), p95: p95 === null ? null : round(p95, 2) },
    meanHands: roundedMean(handsInFrame, 2),
    zones: Array.from({ length: zones }, (_, zone) => summariseZone(frames, zone, expectedShape)),
  };
}
