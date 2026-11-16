import { describe, expect, it } from 'vitest';
import { botFace, botPlayer } from './bot';
import { generateChart } from './chart';
import { BOT, START_CELL } from './config';
import { generateFaceCues } from './faceChart';
import { judgeFaceFrame, newFaceCueState } from './faceJudgment';
import { synthetic } from './fixtures';
import { cellCentre, defaultGrid, faceRegion } from './geometry';
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
    [4, false],
    [4, true],
    [5, false],
  ];

  it.each(cases)('at level %i with shapes %s', (level, shapes) => {
    // 100 BPM is close to the real songs. 109 BPM is the fastest tempo with a cue on every beat,
    // so it leaves the bot the least time from one cell of a slide to the next.
    // At 150 BPM cues sit on every second beat, and so do the cells of a slide.
    for (const bpm of [100, 109, 150]) {
      const { cues, results } = playThrough(synthetic(bpm, 90), level, shapes);
      expect(cues.length).toBeGreaterThan(10);
      expect(results.every((result) => result === 'perfect')).toBe(true);
    }
  });

  it.each([100, 109, 150])('including slides and doubles at level 3, at %i BPM', (bpm) => {
    const { cues } = playThrough(synthetic(bpm, 90), 3, false);
    expect(cues.some((cue) => cue.slideStep === 3)).toBe(true);
    expect(cues.some((cue) => cue.cells.length === 2)).toBe(true);
  });
});

describe('the bot at level 4', () => {
  it('plays slides and off-beat taps Perfect', () => {
    const { cues, results } = playThrough(synthetic(100, 180), 4, false);
    expect(cues.some((cue) => cue.slideStep === 3)).toBe(true);
    expect(cues.some((cue) => !Number.isInteger(cue.beatIndex))).toBe(true);
    expect(results.every((result) => result === 'perfect')).toBe(true);
  });
});

describe('the bot at level 5', () => {
  it('makes the asked-for shape on every cue', () => {
    const { cues, results } = playThrough(synthetic(100, 180), 5, false);
    expect(cues.every((cue) => cue.shapes !== undefined)).toBe(true);
    expect(results.every((result) => result === 'perfect')).toBe(true);
  });
});

describe('the bot with a shape in each cell', () => {
  it('makes the shape of each cell with the hand in it', () => {
    const cue: Cue = { timeSec: 1, beatIndex: 2, cells: [0, 2], shapes: ['fist', 'peace'] };
    const { hands } = botPlayer('play', 1, [cue], grid, 1, SEED);
    expect(hands.map((hand) => hand.gesture)).toEqual(['fist', 'peace']);
    expect(hands[0]).toMatchObject(cellCentre(grid, 0));
    expect(hands[1]).toMatchObject(cellCentre(grid, 2));
  });
});

describe('the bot outside play', () => {
  const cues = chart(synthetic(), 2, false);

  it('keeps its hands down during a calibration', () => {
    expect(botPlayer('fit', 1, cues, grid, 1, SEED).hands).toHaveLength(0);
  });

  it('holds a hand in the Start cell to start and to replay', () => {
    for (const phase of ['ready', 'results'] as const) {
      const { hands } = botPlayer(phase, 1, cues, grid, 1, SEED);
      expect(hands).toHaveLength(1);
      expect(hands[0]).toMatchObject(cellCentre(grid, START_CELL));
    }
  });

  it('never makes a fist on the results, so it never chooses there, and never rates the set', () => {
    for (const timeSec of [0, 1, 5, 30, 300]) {
      const { hands } = botPlayer('results', timeSec, cues, grid, 1, SEED);
      expect(hands.map((hand) => hand.gesture)).not.toContain('fist');
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

describe('the bot with faces on', () => {
  /** Plays the whole song at 60 frames a second, hands and face, and returns every final rating. */
  function playThroughWithFaces(song: Manifest, level: Level, accuracy = 1) {
    const cues = chart(song, level, true);
    const faceCues = generateFaceCues(song, SEED, song.durationSec);
    let states = cues.map(newCueState);
    let faceStates = faceCues.map(newFaceCueState);
    for (let tick = 0; tick <= (song.durationSec + 1) * 60; tick++) {
      const timeSec = tick / 60;
      const { hands, face } = botPlayer('play', timeSec, cues, grid, accuracy, SEED, faceCues);
      states = states.map((state) => judgeFrame(state, level, grid, hands, timeSec));
      faceStates = faceStates.map((state) => judgeFaceFrame(state, level, face, timeSec));
    }
    return {
      faceCues,
      handResults: states.map((state) => state.result),
      faceResults: faceStates.map((state) => state.result),
    };
  }

  it.each([1, 2, 3, 4, 5] as const)('plays every hand cue and every face cue Perfect at level %i', (level) => {
    for (const bpm of [100, 109, 150]) {
      const { faceCues, handResults, faceResults } = playThroughWithFaces(synthetic(bpm, 90), level);
      expect(faceCues.length).toBeGreaterThan(5);
      expect(handResults.length).toBeGreaterThan(10);
      expect(handResults.every((result) => result === 'perfect')).toBe(true);
      expect(faceResults.every((result) => result === 'perfect')).toBe(true);
    }
  });

  it('pulls the face only around a face cue, in the middle of the face region', () => {
    const [first] = generateFaceCues(synthetic(), SEED, 120);
    const region = faceRegion(grid);

    expect(botFace(first.timeSec - BOT.leadSec - 0.01, [first], grid, 1, SEED)).toBeUndefined();
    expect(botFace(first.timeSec + BOT.holdSec + 0.01, [first], grid, 1, SEED)).toBeUndefined();

    const face = botFace(first.timeSec, [first], grid, 1, SEED);
    expect(face?.x).toBeCloseTo(region.x + region.width / 2);
    expect(face?.y).toBeCloseTo(region.y + region.height / 2);
    expect(face?.expressions[first.expression]).toBe(1);
    const strengths = Object.values(face?.expressions ?? {});
    expect(strengths.filter((strength) => strength === 0)).toHaveLength(2);
  });

  it('shows a still face before play, so the face check before play keeps its face cues', () => {
    const region = faceRegion(grid);
    for (const phase of ['ready', 'results', 'countdown'] as const) {
      const { face } = botPlayer(phase, 1, [], grid, 1, SEED);
      expect(face?.x).toBeCloseTo(region.x + region.width / 2);
      expect(face?.y).toBeCloseTo(region.y + region.height / 2);
      expect(face?.expressions).toEqual({ smile: 0, openMouth: 0, pucker: 0 });
    }
  });

  it('has no face during a calibration, and none in play without face cues', () => {
    const faceCues = generateFaceCues(synthetic(), SEED, 120);
    const dueSec = faceCues[0].timeSec;
    expect(botPlayer('fit', dueSec, [], grid, 1, SEED, faceCues).face).toBeUndefined();
    expect(botPlayer('play', dueSec, [], grid, 1, SEED).face).toBeUndefined();
    expect(botPlayer('play', dueSec, [], grid, 1, SEED, faceCues).face).toBeDefined();
  });

  it('shows a still face around a face cue that it skips, so the cue is a Miss and not unseen', () => {
    const [first] = generateFaceCues(synthetic(), SEED, 120);
    const face = botFace(first.timeSec, [first], grid, 0, SEED);
    expect(face?.expressions).toEqual({ smile: 0, openMouth: 0, pucker: 0 });
  });

  it('skips the same face cues on every run when its accuracy is below 1', () => {
    const first = playThroughWithFaces(synthetic(100, 240), 2, 0.5).faceResults;
    const second = playThroughWithFaces(synthetic(100, 240), 2, 0.5).faceResults;
    expect(first).toEqual(second);
    expect(first).toContain('perfect');
    expect(first).toContain('miss');
  });
});
