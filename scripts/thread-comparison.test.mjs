import { describe, expect, it } from 'vitest';
import { compareRuns, frameDistance, numberFrames, pairHands, shiftCheck, streamOffset } from './thread-comparison.mjs';

const FPS = 30;
const ASPECT = 16 / 9;

/** A logged frame for camera frame `n`, with stream time jitter as Chrome's file camera gives. */
function frame(n, hands, { jitter = 0.15, face } = {}) {
  return {
    videoTimeSec: (n + jitter) / FPS,
    timeMs: n * 33.3,
    inferenceMs: 20,
    phase: 'play',
    mode: 'hands-split',
    players: [{ hands, ...(face ? { face } : {}) }, { hands: [] }],
  };
}

const hand = (x, y, gesture = 'open', size = 0.2) => ({ x, y, size, gesture });
/** A hand that moves across the frame, so that a wrong frame match shows. */
const movingHand = (n) => hand(0.2 + n * 0.005, 0.5);

describe('numbering logged frames by camera frame', () => {
  it('finds the camera frame through the stream time jitter', () => {
    const jitters = [0.12, 0.25, 0.18, 0.07, 0.2];
    const frames = jitters.map((jitter, n) => frame(n + 10, [], { jitter }));
    expect([...numberFrames(frames, FPS, streamOffset(FPS, frames)).keys()]).toEqual([10, 11, 12, 13, 14]);
  });

  it('leaves out frames with no stream time', () => {
    const frames = [frame(1, []), { ...frame(2, []), videoTimeSec: null }];
    expect([...numberFrames(frames, FPS, 0).keys()]).toEqual([1]);
  });

  it('numbers two runs alike when their stream times sit on both sides of a whole frame', () => {
    // One run sees its frames a hair before each whole frame, the other a hair after it.
    const early = [-0.02, -0.03, -0.01, -0.02];
    const late = [0.02, 0.01, 0.03, 0.02];
    const runA = early.map((jitter, n) => frame(n + 10, [movingHand(n + 10)], { jitter }));
    const runB = late.map((jitter, n) => frame(n + 10, [movingHand(n + 10)], { jitter }));
    const offset = streamOffset(FPS, runA, runB);
    expect([...numberFrames(runA, FPS, offset).keys()]).toEqual([...numberFrames(runB, FPS, offset).keys()]);
    const result = compareRuns(runA, runB, { fps: FPS, aspect: ASPECT });
    expect(result.matchedFrames).toBe(4);
    expect(result.palmDistance.max).toBe(0);
  });
});

describe('pairing the hands of two runs', () => {
  it('pairs each hand with the nearest one, and leaves an extra hand out', () => {
    const left = hand(0.2, 0.5);
    const right = hand(0.8, 0.5);
    const pairs = pairHands([left, right], [hand(0.79, 0.5)], ASPECT);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].a).toBe(right);
    expect(pairs[0].distance).toBeCloseTo(0.01 * ASPECT);
  });

  it('measures distance in frame heights', () => {
    expect(frameDistance({ x: 0, y: 0 }, { x: 0, y: 0.1 }, ASPECT)).toBeCloseTo(0.1);
    expect(frameDistance({ x: 0, y: 0 }, { x: 0.1, y: 0 }, ASPECT)).toBeCloseTo(0.1 * ASPECT);
  });
});

describe('comparing two runs', () => {
  it('compares only the camera frames both runs tracked', () => {
    // Each run dropped other frames while its tracker was busy.
    const runA = [0, 1, 2, 4, 5].map((n) => frame(n, [movingHand(n)]));
    const runB = [0, 2, 3, 5].map((n) => frame(n, [movingHand(n)], { jitter: 0.2 }));
    const result = compareRuns(runA, runB, { fps: FPS, aspect: ASPECT });
    expect(result.matchedFrames).toBe(3);
    expect(result.palmDistance.max).toBe(0);
    expect(result.sameHandCount).toBe(1);
    expect(result.sameGesture).toBe(1);
  });

  it('leaves out frames that the two runs tracked with different trackers', () => {
    const runA = [frame(0, []), frame(1, [])];
    const runB = [frame(0, []), { ...frame(1, []), mode: 'hands-full' }];
    const result = compareRuns(runA, runB, { fps: FPS, aspect: ASPECT });
    expect(result).toMatchObject({ matchedFrames: 1, otherMode: 1 });
  });

  it('reports a hand that only one run saw', () => {
    const runA = [frame(0, [hand(0.3, 0.5)])];
    const runB = [frame(0, [])];
    const result = compareRuns(runA, runB, { fps: FPS, aspect: ASPECT });
    expect(result.sameHandCount).toBe(0.5); // Player 0 differs; player 1 has no hands in both.
    expect(result.pairedHands).toBe(0);
  });

  it('reports how far paired hands and their shapes differ', () => {
    const runA = [frame(0, [hand(0.3, 0.5, 'fist', 0.2)])];
    const runB = [frame(0, [hand(0.3, 0.52, 'open', 0.25)])];
    const result = compareRuns(runA, runB, { fps: FPS, aspect: ASPECT });
    expect(result.palmDistance.median).toBeCloseTo(0.02);
    expect(result.sizeDifference.median).toBeCloseTo(0.05);
    expect(result.sameGesture).toBe(0);
  });

  it('compares faces where both runs found one', () => {
    const face = (smile) => ({ x: 0.3, y: 0.2, expressions: { smile, openMouth: 0, pucker: 0 } });
    const runA = [frame(0, [], { face: face(0.8) })];
    const runB = [frame(0, [], { face: face(0.7) })];
    const result = compareRuns(runA, runB, { fps: FPS, aspect: ASPECT });
    expect(result.facesCompared).toBe(1);
    expect(result.expressionDifference.max).toBeCloseTo(0.1);
  });
});

describe('checking the frame matching', () => {
  it('finds the least palm distance at shift 0 when the frames match', () => {
    const run = Array.from({ length: 30 }, (_, n) => frame(n, [movingHand(n)]));
    const shifts = shiftCheck(run, run, { fps: FPS, aspect: ASPECT, range: 1 });
    const best = shifts.reduce((a, b) => (b.medianPalmDistance < a.medianPalmDistance ? b : a));
    expect(best.shift).toBe(0);
    expect(shifts.map((entry) => entry.shift)).toEqual([-1, 0, 1]);
  });
});
