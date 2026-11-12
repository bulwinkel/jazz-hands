import { describe, expect, it } from 'vitest';
import type { GestureName } from '../tracking/types';
import type { ZoneFrame, ZoneHand } from '../tracking/zones';
import { percentile, summarisePhase } from './statistics';

const RECORD_MS = 5000;

function hand(gesture: GestureName, size = 0.1, modelGesture?: GestureName): ZoneHand {
  const tracked: ZoneHand = { x: 0.5, y: 0.5, size, gesture, gestureScore: 1 };
  if (modelGesture) tracked.modelGesture = modelGesture;
  return tracked;
}

function frame(zones: ZoneHand[][], inferenceMs = 20, zoneInferenceMs?: number[]): ZoneFrame {
  return { timeMs: 0, inferenceMs, zones, zoneInferenceMs };
}

const OPEN = hand('open');
const FIST = hand('fist');

describe('hands seen in a zone', () => {
  it('gives the share of frames with no hand, one hand and two hands', () => {
    const frames = [
      frame([[], [OPEN, OPEN]]),
      frame([[], [OPEN, OPEN]]),
      frame([[], [OPEN]]),
      frame([[OPEN], []]),
    ];
    const [left, right] = summarisePhase(frames, 2, RECORD_MS, null).zones;

    expect(left).toMatchObject({ noHands: 0.75, oneHand: 0.25, twoHands: 0 });
    expect(right).toMatchObject({ noHands: 0.25, oneHand: 0.25, twoHands: 0.5 });
  });

  it('gives the mean number of hands in a frame over all zones', () => {
    const frames = [frame([[OPEN], [OPEN, OPEN]]), frame([[], [OPEN]])];
    expect(summarisePhase(frames, 2, RECORD_MS, null).meanHands).toBe(2);
  });

  it('gives the mean size of the hands seen', () => {
    const frames = [frame([[hand('open', 0.04), hand('open', 0.06)]]), frame([[]])];
    expect(summarisePhase(frames, 1, RECORD_MS, null).zones[0].meanHandSize).toBe(0.05);
  });
});

describe('shape readings', () => {
  it('gives the share of seen hands with the asked-for shape, read from the fingers', () => {
    const frames = [frame([[OPEN, FIST]]), frame([[OPEN]]), frame([[OPEN]])];
    expect(summarisePhase(frames, 1, RECORD_MS, 'open').zones[0].shapeMatch).toBe(0.75);
  });

  it('gives the same share for the label of the gesture model, kept apart', () => {
    const readAsOpenByModel = hand('fist', 0.1, 'open');
    const readAsNoneByModel = hand('open', 0.1, 'none');
    const frames = [frame([[readAsOpenByModel, readAsNoneByModel]])];
    const [zone] = summarisePhase(frames, 1, RECORD_MS, 'open').zones;

    expect(zone.shapeMatch).toBe(0.5);
    expect(zone.modelLabelMatch).toBe(0.5);
  });

  it('has no model label share for hands from the landmark model', () => {
    const frames = [frame([[OPEN, OPEN]])];
    expect(summarisePhase(frames, 1, RECORD_MS, 'open').zones[0].modelLabelMatch).toBeNull();
  });

  it('has no share when the phase asks for no shape, or no hand was seen', () => {
    expect(summarisePhase([frame([[OPEN]])], 1, RECORD_MS, null).zones[0].shapeMatch).toBeNull();
    expect(summarisePhase([frame([[]])], 1, RECORD_MS, 'open').zones[0].shapeMatch).toBeNull();
  });
});

describe('timing', () => {
  it('gives the frame rate over the length of the recording', () => {
    const frames = Array.from({ length: 145 }, () => frame([[]]));
    expect(summarisePhase(frames, 1, RECORD_MS, null).framesPerSec).toBe(29);
  });

  it('gives the mean and the 95th percentile of the frame time', () => {
    const frames = Array.from({ length: 20 }, (_, index) => frame([[]], index < 19 ? 10 : 110));
    expect(summarisePhase(frames, 1, RECORD_MS, null).inferenceMs).toEqual({ mean: 15, p95: 10 });
  });

  it('takes the percentile by nearest rank', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(5);
    expect(percentile([], 0.95)).toBeNull();
  });

  it('gives the time of each zone by the hands it showed, when zones were timed', () => {
    const frames = [
      frame([[], [OPEN, OPEN]], 30, [8, 22]),
      frame([[], [OPEN, OPEN]], 32, [10, 22]),
      frame([[], [OPEN]], 40, [9, 31]),
    ];
    const [empty, occupied] = summarisePhase(frames, 2, RECORD_MS, null).zones;

    expect(empty.inferenceMs).toEqual({ noHands: 9, oneHand: null, twoHands: null });
    expect(occupied.inferenceMs).toEqual({ noHands: null, oneHand: 31, twoHands: 22 });
  });

  it('leaves the zone times out when the tracker ran one model for all zones', () => {
    const [zone] = summarisePhase([frame([[OPEN]])], 1, RECORD_MS, null).zones;
    expect(zone).not.toHaveProperty('inferenceMs');
  });
});

describe('a recording with no frames', () => {
  it('has no measurements and does not fail', () => {
    const summary = summarisePhase([], 2, RECORD_MS, 'open');

    expect(summary).toMatchObject({ frames: 0, framesPerSec: 0, meanHands: null });
    expect(summary.inferenceMs).toEqual({ mean: null, p95: null });
    expect(summary.zones).toHaveLength(2);
    expect(summary.zones[0]).toMatchObject({ noHands: 0, oneHand: 0, twoHands: 0, meanHandSize: null });
  });
});
