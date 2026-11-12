import type { GestureName, TrackerMode, TrackingFrame } from '../tracking/types';

export function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/** Nearest-rank percentile. Empty evidence has no measurement. */
export function percentile(values: readonly number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1))];
}

export interface PlayerStatistics {
  recordedFrameCount: number;
  exactlyTwoHandsFraction: number | null;
  atLeastTwoHandsFraction: number | null;
  atLeastOneHandFraction: number | null;
  meanHandsDetected: number | null;
  gestureMatchFraction: number | null;
  meanGestureScore: number | null;
  meanHandSize: number | null;
  fps: number;
  meanInferenceMs: number | null;
  p95InferenceMs: number | null;
}

export function summarizePhase(
  frames: readonly TrackingFrame[], durationMs: number, mode: TrackerMode, expected: GestureName | null,
): [PlayerStatistics, PlayerStatistics] {
  return ([0, 1] as const).map((player) => {
    const counts = frames.map((frame) => frame.players[player].hands.length);
    const hands = frames.flatMap((frame) => frame.players[player].hands);
    const fraction = (predicate: (count: number) => boolean) =>
      counts.length ? counts.filter(predicate).length / counts.length : null;
    return {
      recordedFrameCount: frames.length,
      exactlyTwoHandsFraction: fraction((count) => count === 2),
      atLeastTwoHandsFraction: fraction((count) => count >= 2),
      atLeastOneHandFraction: fraction((count) => count >= 1),
      meanHandsDetected: mean(counts),
      gestureMatchFraction: expected && mode !== 'pose' && hands.length
        ? hands.filter((hand) => hand.gesture === expected).length / hands.length : null,
      meanGestureScore: mean(hands.map((hand) => hand.gestureScore)),
      meanHandSize: mean(hands.map((hand) => hand.size)),
      fps: durationMs > 0 ? frames.length / (durationMs / 1000) : 0,
      meanInferenceMs: mean(frames.map((frame) => frame.inferenceMs)),
      p95InferenceMs: percentile(frames.map((frame) => frame.inferenceMs), 0.95),
    };
  }) as [PlayerStatistics, PlayerStatistics];
}
