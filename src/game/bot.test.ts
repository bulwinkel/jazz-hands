import { expect, it } from 'vitest';
import { botPlayer } from './bot';
import { generateChart } from './chart';
import { defaultGrid } from './geometry';
import { cueState, judgeFrame } from './judgment';
import { synthetic } from './fixtures';
import type { Level } from './types';
for (const level of [1, 2, 3] as Level[]) it(`bot gets 100% Perfect at level ${level}`, () => {
  const m = synthetic(60, 80); const cues = generateChart(m, level, 99); const states = cues.map(cueState); const grid = defaultGrid(0);
  expect(cues.length).toBeGreaterThan(10);
  for (let tick = 0; tick < 81 * 60; tick++) {
    const time = tick / 60; const hands = botPlayer('play', time, cues, grid, true, 1, 99).hands;
    states.forEach((s, i) => { states[i] = judgeFrame(s, level, grid, hands, time - 0.1); });
  }
  expect(states.every(s => s.result === 'perfect')).toBe(true);
});
it('skips deterministically and leaves Fit empty', () => {
  const m = synthetic(); const cues = generateChart(m, 2, 3); const grid = defaultGrid(1);
  expect(botPlayer('fit', 1, cues, grid, true, 1, 3).hands).toHaveLength(0);
  expect(botPlayer('ready', 1, cues, grid, true, 1, 3).hands).toHaveLength(1);
  const hits = cues.map(c => botPlayer('play', c.timeSec, cues, grid, true, 0.5, 3).hands.length > 0);
  expect(hits).toEqual(cues.map(c => botPlayer('play', c.timeSec, cues, grid, true, 0.5, 3).hands.length > 0));
  expect(hits.some(Boolean) && hits.some(v => !v)).toBe(true);
});
