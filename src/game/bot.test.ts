import { describe, expect, it } from 'vitest';
import { botPlayer } from './bot';
import { generateChart } from './chart';
import { HANDS_UP_CELL } from './config';
import { synthetic } from './fixtures';
import { cellCentre, defaultGrid } from './geometry';
import { judgeFrame, newCueState } from './judgment';
import type { Cue, Level, Manifest } from './types';

const SEED = 99;
const grid = defaultGrid(0, 1);

function chart(song: Manifest, level: Level, shapes: boolean): Cue[] {
  return generateChart(song, { level, shapes, seed: SEED, endSec: song.durationSec });
}

/** Plays the whole song at 60 frames a second and returns the final rating of every cue. */
function playThrough(song: Manifest, level: Level, shapes: boolean, accuracy = 1) {
  const cues = chart(song, level, shapes);
  let states = cues.map(newCueState);
  for (let tick = 0; tick <= (song.durationSec + 1) * 60; tick++) {
    const timeSec = tick / 60;
    const { hands } = botPlayer('play', timeSec, cues, grid, accuracy, SEED);
    states = states.map((state) => judgeFrame(state, level, grid, hands, timeSec));
  }
  return { cues, results: states.map((state) => state.result) };
}

describe('the bot plays every cue Perfect', () => {
  const cases: [Level, boolean][] = [
    [1, false],
    [1, true],
    [2, false],
    [2, true],
    [3, false],
    [3, true],
  ];

  it.each(cases)('at level %i with shapes %s', (level, shapes) => {
    // 100 BPM is close to the real songs. 109 BPM is the fastest tempo with a cue on every beat,
    // so it leaves the bot the least time between the end of a slide and the next cue.
    for (const bpm of [100, 109]) {
      const { cues, results } = playThrough(synthetic(bpm, 90), level, shapes);
      expect(cues.length).toBeGreaterThan(10);
      expect(results.every((result) => result === 'perfect')).toBe(true);
    }
  });

  it.each([100, 109])('including slides and doubles at level 3, at %i BPM', (bpm) => {
    const { cues } = playThrough(synthetic(bpm, 90), 3, false);
    expect(cues.some((cue) => cue.kind === 'slide')).toBe(true);
    expect(cues.some((cue) => cue.kind === 'tap' && cue.cells.length === 2)).toBe(true);
  });
});

describe('the bot outside play', () => {
  const cues = chart(synthetic(), 2, false);

  it('keeps its hands down during the reach fit', () => {
    expect(botPlayer('fit', 1, cues, grid, 1, SEED).hands).toHaveLength(0);
  });

  it('raises a hand in the hands-up cell to start and to replay', () => {
    for (const phase of ['ready', 'results'] as const) {
      const { hands } = botPlayer(phase, 1, cues, grid, 1, SEED);
      expect(hands).toHaveLength(1);
      expect(hands[0]).toMatchObject(cellCentre(grid, HANDS_UP_CELL));
    }
  });
});

describe('a bot with accuracy below 1', () => {
  it('skips the same cues on every run, and misses them', () => {
    const first = playThrough(synthetic(100, 90), 2, false, 0.5).results;
    const second = playThrough(synthetic(100, 90), 2, false, 0.5).results;
    expect(first).toEqual(second);
    expect(first).toContain('perfect');
    expect(first).toContain('miss');
  });
});
