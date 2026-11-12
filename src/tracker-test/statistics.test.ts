import { expect, it } from 'vitest';
import type { GestureName, TrackingFrame } from '../tracking/types';
import { mean, percentile, summarizePhase } from './statistics';

function frame(gestures: GestureName[], inferenceMs: number): TrackingFrame {
  return { timeMs: 0, inferenceMs, players: [
    { hands: gestures.map((gesture) => ({ x: 0.2, y: 0.5, gesture, size: 0.1, gestureScore: 0.8 })) },
    { hands: [] },
  ] };
}

it('uses frames for detection fractions and detected hands for gesture fractions', () => {
  const [left, right] = summarizePhase([frame([], 10), frame(['open'], 20), frame(['open', 'fist'], 30)],
    5000, 'hands-full', 'open');
  expect(left.recordedFrameCount).toBe(3);
  expect(left.exactlyTwoHandsFraction).toBeCloseTo(1 / 3);
  expect(left.atLeastTwoHandsFraction).toBeCloseTo(1 / 3);
  expect(left.atLeastOneHandFraction).toBeCloseTo(2 / 3);
  expect(left.meanHandsDetected).toBe(1);
  expect(left.gestureMatchFraction).toBeCloseTo(2 / 3);
  expect(left.meanGestureScore).toBeCloseTo(0.8);
  expect(left.meanHandSize).toBeCloseTo(0.1);
  expect(left.fps).toBe(0.6);
  expect(left.meanInferenceMs).toBe(20);
  expect(left.p95InferenceMs).toBe(30);
  expect(right.atLeastOneHandFraction).toBe(0);
  expect(right.gestureMatchFraction).toBeNull();
  expect(right.meanHandSize).toBeNull();
  expect(right.recordedFrameCount).toBe(3);
});

it('distinguishes no evidence from zero detection and marks unsupported gestures null', () => {
  expect(summarizePhase([], 5000, 'hands-full', 'open')[0].atLeastOneHandFraction).toBeNull();
  expect(summarizePhase([frame(['open'], 1)], 5000, 'pose', 'open')[0].gestureMatchFraction).toBeNull();
  expect(summarizePhase([frame(['open'], 1)], 5000, 'hands-full', null)[0].gestureMatchFraction).toBeNull();
  expect(mean([])).toBeNull();
  expect(percentile([], 0.95)).toBeNull();
  expect(percentile(Array.from({ length: 100 }, (_, index) => 100 - index), 0.95)).toBe(95);
});
