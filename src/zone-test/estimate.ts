import { HANDS_PER_ZONE } from '../tracking/zoneGeometry';
import type { ZoneLayout } from '../tracking/zones';
import { OCCUPIED_SHARE } from './config';
import { round } from './statistics';
import type { PhaseSummary } from './statistics';

/**
 * What a frame would cost with a player in every zone, worked out from a run with one or two.
 *
 * Nobody can fill three or four zones alone, so the test measures the two parts of the cost
 * apart and adds them up. With no hand in view a model runs only its detector. With hands held
 * still it also follows those hands. The difference is what the hands cost.
 */

/** The time of one frame with every zone full, and the frame rate that time allows. */
export interface Estimate {
  /** Every hand is followed, so no detector runs. This is the best case. */
  everyHandTrackedMs: number | null;
  everyHandTrackedFps: number | null;
  /**
   * The same plus the detector cost. A frame costs up to this much while a hand is lost,
   * because the detector then searches for it again.
   */
  withDetectorMs: number | null;
  withDetectorFps: number | null;
}

export interface VariantDerived {
  /** Zones with a person: a hand was seen there in more than half the frames with open hands. */
  occupiedZones: number[];
  /** Mean hands seen while the hands were hidden. More than 0 means the detector cost is too high. */
  handsSeenWhileHidden: number | null;
  /** Mean hands seen with open hands held up. Every estimate rests on these few hands. */
  handsMeasured: number | null;
  /** Mean time of a frame with no hand in view: the detector, and what every frame costs. */
  detectorMs: number | null;
  costPerHandMs: number | null;
  /** `crops` only: what one zone took with no hand in it, and with both its hands followed. */
  emptyZoneMs?: number | null;
  fullZoneMs?: number | null;
  estimate: Estimate;
  /** How the estimate was made and how far to trust it, in words. */
  notes: string[];
}

export interface DeriveInput {
  layout: ZoneLayout;
  zones: number;
  /** The phase with the hands behind the back. */
  handsHidden: PhaseSummary;
  /** The phase with open hands held up. */
  handsShown: PhaseSummary;
  /** No tracker runs faster than the camera delivers frames. */
  cameraFps: number;
}

/** The cost of the hands, as far as one layout lets it be read from the run. */
interface HandCost {
  costPerHandMs: number | null;
  everyHandTrackedMs: number | null;
  emptyZoneMs?: number | null;
  fullZoneMs?: number | null;
  /** How the numbers were made, or why they could not be. */
  method: string;
}

/** Up to this many hands seen in a frame on average, while the hands are hidden, count as noise. */
const HIDDEN_HANDS_TOLERANCE = 0.1;

/** The zones where a person stood: a hand was seen in more than half the frames. */
export function occupiedZones(handsShown: PhaseSummary): number[] {
  return handsShown.zones.flatMap((zone, index) =>
    zone.oneHand + zone.twoHands > OCCUPIED_SHARE ? [index] : [],
  );
}

/** Share of frames in which both hands were found, averaged over the zones with a person. */
export function bothHandsShare(phase: PhaseSummary, occupied: readonly number[]): number | null {
  if (occupied.length === 0) return null;
  const total = occupied.reduce((sum, zone) => sum + phase.zones[zone].twoHands, 0);
  return total / occupied.length;
}

/** Share of the hands seen in the zones with a person that showed the asked-for shape. */
export function shapeMatchShare(
  phase: PhaseSummary,
  occupied: readonly number[],
  reading: 'shapeMatch' | 'modelLabelMatch',
): number | null {
  const shares = occupied.map((zone) => phase.zones[zone][reading]).filter((value) => value !== null);
  if (shares.length === 0) return null;
  return shares.reduce((sum, value) => sum + value, 0) / shares.length;
}

/** The mean of the values, each counted by its weight. Null when nothing has weight. */
function weightedMean(entries: readonly { value: number | null | undefined; weight: number }[]): number | null {
  let sum = 0;
  let totalWeight = 0;
  for (const { value, weight } of entries) {
    if (value === null || value === undefined) continue;
    sum += value * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? sum / totalWeight : null;
}

/**
 * One model on the full frame. It is asked for more hands than a lone tester has, so its
 * detector runs in both phases, and the phases differ only by the hands that are followed.
 */
function fullFrameCost(input: DeriveInput): HandCost {
  const hiddenMs = input.handsHidden.inferenceMs.mean;
  const shownMs = input.handsShown.inferenceMs.mean;
  const hands = input.handsShown.meanHands;
  if (hiddenMs === null || shownMs === null || !hands) {
    return { costPerHandMs: null, everyHandTrackedMs: null, method: 'No frames with hands, so no cost per hand.' };
  }

  const costPerHandMs = (shownMs - hiddenMs) / hands;
  if (costPerHandMs <= 0) {
    return {
      costPerHandMs,
      everyHandTrackedMs: null,
      method: 'A frame with hands was not slower than a frame without. No estimate can be made from this run.',
    };
  }
  const handsWhenFull = HANDS_PER_ZONE * input.zones;
  return {
    costPerHandMs,
    everyHandTrackedMs: costPerHandMs * handsWhenFull,
    method:
      `A frame with ${hands} hands in view took ${round(shownMs - hiddenMs, 2)} ms longer than a frame with none, ` +
      `so one hand costs ${round(costPerHandMs, 2)} ms. Every zone full is ${handsWhenFull} hands. ` +
      'The model then follows every hand it was asked for, and its detector does not run.',
  };
}

/**
 * One model for each zone. A zone that follows both its hands stops its detector, so a frame
 * with hands can even be faster than a frame without, and the difference between the phases
 * says little. The tracker times every zone by itself, so a full zone is measured directly.
 */
function cropsCost(input: DeriveInput, occupied: readonly number[]): HandCost {
  const emptyZoneMs = weightedMean(
    input.handsHidden.zones.map((zone) => ({ value: zone.inferenceMs?.noHands, weight: zone.noHands })),
  );
  const fullZoneMs = weightedMean(
    occupied.map((index) => {
      const zone = input.handsShown.zones[index];
      return { value: zone.inferenceMs?.twoHands, weight: zone.twoHands };
    }),
  );
  if (fullZoneMs === null) {
    return {
      costPerHandMs: null,
      everyHandTrackedMs: null,
      emptyZoneMs,
      fullZoneMs,
      method: 'No zone showed two hands, so the cost of a full zone is not known.',
    };
  }
  return {
    costPerHandMs: fullZoneMs / HANDS_PER_ZONE,
    everyHandTrackedMs: fullZoneMs * input.zones,
    emptyZoneMs,
    fullZoneMs,
    method:
      `A zone that followed both hands took ${round(fullZoneMs, 2)} ms for its crop and its model. ` +
      `Every zone full is that time for each of the ${input.zones} zones. ` +
      'The cost per hand is half of it, and includes the crop. ' +
      'The difference between the two phases is not used: a zone stops its detector once it follows two hands.',
  };
}

function framesPerSec(frameMs: number | null, cameraFps: number): number | null {
  if (frameMs === null || frameMs <= 0) return null;
  return round(Math.min(cameraFps, 1000 / frameMs), 1);
}

function roundOrNull(value: number | null | undefined): number | null {
  return value === null || value === undefined ? null : round(value, 2);
}

function trustNotes(input: DeriveInput, occupied: readonly number[]): string[] {
  const notes: string[] = [];
  const hands = input.handsShown.meanHands ?? 0;
  if (occupied.length === 0) {
    notes.push('No zone had a person during OPEN HANDS, so nothing here describes a player.');
  } else {
    notes.push(
      `These numbers rest on ${hands} hands seen in ${occupied.length} of ${input.zones} zones. ` +
        'An estimate is not a measurement with every zone full. It assumes that every further hand costs the same.',
    );
  }
  const hiddenHands = input.handsHidden.meanHands ?? 0;
  if (hiddenHands > HIDDEN_HANDS_TOLERANCE) {
    notes.push(
      `${hiddenHands} hands were seen on average while the hands should be hidden. ` +
        'The detector cost is then too high and the cost per hand too low.',
    );
  }
  return notes;
}

/** The derived numbers of one variant, from its phase with hidden hands and its phase with open hands. */
export function deriveVariant(input: DeriveInput): VariantDerived {
  const occupied = occupiedZones(input.handsShown);
  const detectorMs = input.handsHidden.inferenceMs.mean;
  const cost = input.layout === 'crops' ? cropsCost(input, occupied) : fullFrameCost(input);

  const everyHandTrackedMs = occupied.length > 0 ? cost.everyHandTrackedMs : null;
  const withDetectorMs =
    everyHandTrackedMs !== null && detectorMs !== null ? everyHandTrackedMs + detectorMs : null;

  const derived: VariantDerived = {
    occupiedZones: occupied,
    handsSeenWhileHidden: input.handsHidden.meanHands,
    handsMeasured: input.handsShown.meanHands,
    detectorMs,
    costPerHandMs: roundOrNull(cost.costPerHandMs),
    estimate: {
      everyHandTrackedMs: roundOrNull(everyHandTrackedMs),
      everyHandTrackedFps: framesPerSec(everyHandTrackedMs, input.cameraFps),
      withDetectorMs: roundOrNull(withDetectorMs),
      withDetectorFps: framesPerSec(withDetectorMs, input.cameraFps),
    },
    notes: [cost.method, ...trustNotes(input, occupied)],
  };
  if (input.layout === 'crops') {
    derived.emptyZoneMs = roundOrNull(cost.emptyZoneMs);
    derived.fullZoneMs = roundOrNull(cost.fullZoneMs);
  }
  return derived;
}
