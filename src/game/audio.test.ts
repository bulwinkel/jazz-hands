import { describe, expect, it } from 'vitest';
import { MAX_RECORDING_DELAY_SEC, recordingDelays } from './audio';
import { AV_OFFSET_RANGE_MS, INPUT_LATENCY_RANGE_MS } from './settings';

describe('recording sound delays', () => {
  it('delay the game view by the speakers and the picture offset, and the camera view by the camera too', () => {
    const delays = recordingDelays(0.04, 100, 120);
    expect(delays.game).toBeCloseTo(0.14);
    expect(delays.camera).toBeCloseTo(0.26);
  });

  it('apply no delay where the offsets add up to less than zero, because sound cannot come earlier', () => {
    expect(recordingDelays(0.04, -500, 120)).toEqual({ game: 0, camera: 0 });
    const delays = recordingDelays(0.04, -100, 300);
    expect(delays.game).toBe(0);
    expect(delays.camera).toBeCloseTo(0.24);
  });

  it('hold the largest offsets the settings allow, with room for slow speakers', () => {
    const largest = recordingDelays(0.3, AV_OFFSET_RANGE_MS[1], INPUT_LATENCY_RANGE_MS[1]);
    expect(largest.game).toBeCloseTo(2.3);
    expect(largest.camera).toBeCloseTo(4.3);
    expect(largest.camera).toBeLessThan(MAX_RECORDING_DELAY_SEC);
  });

  it('never ask for more than a delay node can hold', () => {
    expect(recordingDelays(0, 9000, 9000).camera).toBe(MAX_RECORDING_DELAY_SEC);
  });
});
