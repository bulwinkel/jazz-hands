import { describe, expect, it } from 'vitest';
import { bothHandsShare, deriveVariant, occupiedZones, shapeMatchShare } from './estimate';
import type { PhaseSummary, ZoneSummary } from './statistics';

const CAMERA_FPS = 30;

/** A zone that showed two hands in `twoHands` of the frames, and none in the rest. */
function zone(twoHands: number, extra: Partial<ZoneSummary> = {}): ZoneSummary {
  return {
    noHands: 1 - twoHands,
    oneHand: 0,
    twoHands,
    meanHandSize: twoHands > 0 ? 0.05 : null,
    shapeMatch: null,
    modelLabelMatch: null,
    ...extra,
  };
}

function phase(meanMs: number, zones: ZoneSummary[]): PhaseSummary {
  const meanHands = zones.reduce((sum, each) => sum + each.oneHand + 2 * each.twoHands, 0);
  return { frames: 150, framesPerSec: 30, inferenceMs: { mean: meanMs, p95: meanMs + 5 }, meanHands, zones };
}

const NOBODY = [zone(0), zone(0), zone(0)];
const PERSON_IN_MIDDLE = [zone(0), zone(1), zone(0)];

describe('zones with a person', () => {
  it('are the zones with a hand in more than half the frames', () => {
    const zones = [zone(0.6), zone(0.5), zone(0, { noHands: 0.3, oneHand: 0.7 })];
    expect(occupiedZones(phase(20, zones))).toEqual([0, 2]);
  });

  it('are none when the recording has no frames', () => {
    const empty: ZoneSummary = { ...zone(0), noHands: 0 };
    expect(occupiedZones(phase(20, [empty, empty]))).toEqual([]);
  });
});

describe('detection in the zones with a person', () => {
  const zones = [zone(0.9, { shapeMatch: 0.8 }), zone(0), zone(0.7, { shapeMatch: 0.6 })];

  it('averages the share of frames with both hands', () => {
    expect(bothHandsShare(phase(20, zones), [0, 2])).toBeCloseTo(0.8);
    expect(bothHandsShare(phase(20, zones), [])).toBeNull();
  });

  it('averages the share of hands with the right shape', () => {
    expect(shapeMatchShare(phase(20, zones), [0, 2], 'shapeMatch')).toBeCloseTo(0.7);
    expect(shapeMatchShare(phase(20, zones), [0, 2], 'modelLabelMatch')).toBeNull();
  });
});

describe('one model on the full frame', () => {
  const derived = deriveVariant({
    layout: 'full',
    zones: 3,
    handsHidden: phase(20, NOBODY),
    handsShown: phase(26, PERSON_IN_MIDDLE),
    cameraFps: CAMERA_FPS,
  });

  it('takes the detector cost from the frames with no hand', () => {
    expect(derived.detectorMs).toBe(20);
  });

  it('takes the cost per hand from what the hands added to a frame', () => {
    expect(derived.handsMeasured).toBe(2);
    expect(derived.costPerHandMs).toBe(3);
  });

  it('estimates every zone full as the cost per hand times two hands per zone', () => {
    expect(derived.estimate.everyHandTrackedMs).toBe(18);
    expect(derived.estimate.withDetectorMs).toBe(38);
  });

  it('gives the estimates as frame rates, never above the camera rate', () => {
    expect(derived.estimate.everyHandTrackedFps).toBe(CAMERA_FPS);
    expect(derived.estimate.withDetectorFps).toBe(26.3);
  });

  it('says in words how many hands the estimate rests on', () => {
    expect(derived.occupiedZones).toEqual([1]);
    expect(derived.notes.join(' ')).toContain('rest on 2 hands seen in 1 of 3 zones');
  });

  it('has no zone times', () => {
    expect(derived).not.toHaveProperty('fullZoneMs');
  });
});

describe('one model on the full frame, runs that allow no estimate', () => {
  it('estimates nothing when no zone had a person', () => {
    const derived = deriveVariant({
      layout: 'full',
      zones: 4,
      handsHidden: phase(20, [...NOBODY, zone(0)]),
      handsShown: phase(21, [...NOBODY, zone(0)]),
      cameraFps: CAMERA_FPS,
    });

    expect(derived.occupiedZones).toEqual([]);
    expect(derived.costPerHandMs).toBeNull();
    expect(derived.estimate.everyHandTrackedMs).toBeNull();
    expect(derived.estimate.withDetectorFps).toBeNull();
    expect(derived.notes.join(' ')).toContain('No zone had a person');
  });

  it('estimates nothing when frames with hands were not slower', () => {
    const derived = deriveVariant({
      layout: 'full',
      zones: 3,
      handsHidden: phase(22, NOBODY),
      handsShown: phase(21, PERSON_IN_MIDDLE),
      cameraFps: CAMERA_FPS,
    });

    expect(derived.costPerHandMs).toBe(-0.5);
    expect(derived.estimate.everyHandTrackedMs).toBeNull();
  });

  it('warns when hands were seen while they should be hidden', () => {
    const derived = deriveVariant({
      layout: 'full',
      zones: 3,
      handsHidden: phase(24, [zone(0), zone(0.4), zone(0)]),
      handsShown: phase(26, PERSON_IN_MIDDLE),
      cameraFps: CAMERA_FPS,
    });

    expect(derived.handsSeenWhileHidden).toBe(0.8);
    expect(derived.notes.join(' ')).toContain('0.8 hands were seen on average while the hands should be hidden');
  });
});

describe('one model per zone', () => {
  const emptyZone = (ms: number): ZoneSummary =>
    zone(0, { inferenceMs: { noHands: ms, oneHand: null, twoHands: null } });
  // The person's zone followed both hands in 80% of the frames, and found none in the rest.
  const personZone = zone(0.8, { inferenceMs: { noHands: 9, oneHand: null, twoHands: 12 } });

  const derived = deriveVariant({
    layout: 'crops',
    zones: 3,
    handsHidden: phase(27, [emptyZone(8), emptyZone(9), emptyZone(10)]),
    handsShown: phase(29, [emptyZone(8), personZone, emptyZone(10)]),
    cameraFps: CAMERA_FPS,
  });

  it('measures a full zone directly, in the zone with a person', () => {
    expect(derived.fullZoneMs).toBe(12);
    expect(derived.emptyZoneMs).toBe(9);
  });

  it('estimates every zone full as that time for each zone', () => {
    expect(derived.estimate.everyHandTrackedMs).toBe(36);
    expect(derived.estimate.everyHandTrackedFps).toBe(27.8);
  });

  it('adds the detector cost of all zones for the frames where hands are lost', () => {
    expect(derived.detectorMs).toBe(27);
    expect(derived.estimate.withDetectorMs).toBe(63);
  });

  it('gives half a full zone as the cost per hand, and says so', () => {
    expect(derived.costPerHandMs).toBe(6);
    expect(derived.notes[0]).toContain('The cost per hand is half of it');
  });

  it('estimates nothing when no zone ever showed two hands', () => {
    const oneHandOnly = zone(0, {
      noHands: 0.2,
      oneHand: 0.8,
      inferenceMs: { noHands: 9, oneHand: 14, twoHands: null },
    });
    const none = deriveVariant({
      layout: 'crops',
      zones: 3,
      handsHidden: phase(27, [emptyZone(8), emptyZone(9), emptyZone(10)]),
      handsShown: phase(32, [emptyZone(8), oneHandOnly, emptyZone(10)]),
      cameraFps: CAMERA_FPS,
    });

    expect(none.occupiedZones).toEqual([1]);
    expect(none.fullZoneMs).toBeNull();
    expect(none.estimate.everyHandTrackedMs).toBeNull();
  });
});
