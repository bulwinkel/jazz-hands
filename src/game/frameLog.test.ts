import { describe, expect, it } from 'vitest';
import type { TrackingFrame } from '../tracking/types';
import { logEntry } from './frameLog';

const source = { mode: 'hands-split', thread: 'worker' };

const frame: TrackingFrame = {
  timeMs: 1234.567,
  inferenceMs: 23.456,
  videoTimeSec: 4.20394,
  players: [
    {
      hands: [
        {
          x: 0.123456,
          y: 0.654321,
          size: 0.0987654,
          gesture: 'fist',
          gestureScore: 0.9,
          landmarks: [{ x: 0.1, y: 0.2 }],
        },
      ],
      face: { x: 0.25555, y: 0.33333, expressions: { smile: 0.812345, openMouth: 0.1, pucker: 0 } },
    },
    { hands: [] },
  ],
};

describe('an entry of the frame log', () => {
  it('keeps the camera frame time, to match frames between runs', () => {
    expect(logEntry(frame, 'play', source).videoTimeSec).toBe(4.20394);
  });

  it('has no camera frame time for an input that gives none', () => {
    expect(logEntry({ ...frame, videoTimeSec: undefined }, 'play', source).videoTimeSec).toBeNull();
  });

  it('keeps what the game judges by, rounded to a fifth of a pixel, with no landmarks', () => {
    const [player] = logEntry(frame, 'play', source).players;
    expect(player.hands).toEqual([{ x: 0.1235, y: 0.6543, size: 0.0988, gesture: 'fist' }]);
  });

  it('keeps a face with its expressions', () => {
    const [player, other] = logEntry(frame, 'play', source).players;
    expect(player.face).toEqual({ x: 0.2556, y: 0.3333, expressions: { smile: 0.8123, openMouth: 0.1, pucker: 0 } });
    expect(other).toEqual({ hands: [] });
  });

  it('names the phase, the tracker mode and its thread', () => {
    expect(logEntry(frame, 'ready', { mode: 'pose', thread: 'main' })).toMatchObject({
      phase: 'ready',
      mode: 'pose',
      thread: 'main',
      timeMs: 1234.6,
      inferenceMs: 23.5,
    });
  });
});
