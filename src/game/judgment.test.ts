import { describe, expect, it } from 'vitest';
import type { TrackedHand } from '../tracking/types';
import { GAME_CONFIG as C } from './config';
import { cellCentre, defaultGrid } from './geometry';
import { cueState, frameSongTime, judgeFrame as transition } from './judgment';
import type { Level } from './types';
const grid = defaultGrid(0);
const hand = (cell = 4, gesture: TrackedHand['gesture'] = 'open'): TrackedHand => ({ ...cellCentre(grid, cell), gesture, size: 0.05, gestureScore: 1 });
// The simulation owns state. The rule transition does not mutate its input.
function judgeFrame(...args: Parameters<typeof transition>) {
  const previous = args[0].result; const next = transition(...args);
  Object.assign(args[0], next); return previous ? undefined : next.result;
}
describe('judgment', () => {
  it('does not mutate the previous state', () => {
    const before = cueState({ timeSec: 1, beatIndex: 2, cells: [4] });
    const after = transition(before, 2, grid, [hand()], 1);
    expect(before.cells).toEqual([null]); expect(before.result).toBeUndefined(); expect(after.result).toBe('perfect');
  });
  for (const level of [1, 2, 3] as Level[]) {
    it(`checks all exact window edges at level ${level}`, () => {
      const w = C.windows[level];
      for (const edge of w.perfect) { const s = cueState({ timeSec: 1, beatIndex: 2, cells: [4] }); expect(judgeFrame(s, level, grid, [hand()], 1 + edge / 1000)).toBe('perfect'); }
      for (const edge of w.good) { const s = cueState({ timeSec: 1, beatIndex: 2, cells: [4] }); expect(judgeFrame(s, level, grid, [hand()], 1 + edge / 1000)).toBeUndefined(); expect(judgeFrame(s, level, grid, [], 1 + (w.good[1] + 1) / 1000)).toBe('good'); }
      for (const edge of [w.good[0] - 1, w.good[1] + 1]) { const s = cueState({ timeSec: 1, beatIndex: 2, cells: [4] }); judgeFrame(s, level, grid, [hand()], 1 + edge / 1000); judgeFrame(s, level, grid, [], 2); expect(s.result).toBe('miss'); }
      for (const edge of [w.perfect[0] - 1, w.perfect[1] + 1]) { const s = cueState({ timeSec: 1, beatIndex: 2, cells: [4] }); judgeFrame(s, level, grid, [hand()], 1 + edge / 1000); judgeFrame(s, level, grid, [], 2); expect(s.result).toBe('good'); }
    });
    it(`upgrades early-and-hold to Perfect immediately at level ${level}`, () => {
      const s = cueState({ timeSec: 1, beatIndex: 2, cells: [4] });
      expect(judgeFrame(s, level, grid, [hand()], 0.75)).toBeUndefined(); expect(judgeFrame(s, level, grid, [hand()], 1 + C.windows[level].perfect[0] / 1000)).toBe('perfect');
      expect(judgeFrame(s, level, grid, [], 2)).toBeUndefined();
    });
  }
  it('takes the worse double-cell result', () => {
    const s = cueState({ timeSec: 1, beatIndex: 2, cells: [0, 2] });
    judgeFrame(s, 2, grid, [hand(0)], 1); judgeFrame(s, 2, grid, [hand(2)], 1.3); expect(judgeFrame(s, 2, grid, [], 1.4)).toBe('good');
    const miss = cueState(s.cue); judgeFrame(miss, 2, grid, [hand(0)], 1); expect(judgeFrame(miss, 2, grid, [], 1.4)).toBe('miss');
  });
  it('allows unknown gestures, rejects wrong known gestures', () => {
    const cue = { timeSec: 1, beatIndex: 2, cells: [4], gesture: 'fist' as const };
    expect(judgeFrame(cueState(cue), 3, grid, [hand(4, 'unknown')], 1)).toBe('perfect');
    const s = cueState(cue); judgeFrame(s, 3, grid, [hand()], 1); expect(judgeFrame(s, 3, grid, [], 2)).toBe('miss');
  });
  it('corrects capture and input latency', () => { expect(frameSongTime(10, 1200, 1000, 100)).toBeCloseTo(9.7); });
});
