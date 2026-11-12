import { describe, expect, it } from 'vitest';
import { botFace, botPlayer } from './bot';
import { generateChart } from './chart';
import { BOT, HANDS_UP_CELL } from './config';
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
  ];

  it.each(cases)('at level %i with shapes %s', (level, shapes) => {
    // 100 BPM is close to the real song. 150 BPM makes slide ends and the next cue overlap.
    for (const bpm of [100, 150]) {
      const { cues, results } = playThrough(synthetic(bpm, 90), level, shapes);
      expect(cues.length).toBeGreaterThan(10);
      expect(results.every((result) => result === 'perfect')).toBe(true);
    }
  });

  it('including slides and doubles at level 3', () => {
    const { cues } = playThrough(synthetic(100, 90), 3, false);
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

  it.each([1, 2, 3] as const)('plays every hand cue and every face cue Perfect at level %i', (level) => {
    for (const bpm of [100, 150]) {
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

  it('has no face outside play, and none without face cues', () => {
    const faceCues = generateFaceCues(synthetic(), SEED, 120);
    const dueSec = faceCues[0].timeSec;
    expect(botPlayer('ready', dueSec, [], grid, 1, SEED, faceCues).face).toBeUndefined();
    expect(botPlayer('results', dueSec, [], grid, 1, SEED, faceCues).face).toBeUndefined();
    expect(botPlayer('play', dueSec, [], grid, 1, SEED).face).toBeUndefined();
    expect(botPlayer('play', dueSec, [], grid, 1, SEED, faceCues).face).toBeDefined();
  });

  it('skips the same face cues on every run when its accuracy is below 1', () => {
    const first = playThroughWithFaces(synthetic(100, 240), 2, 0.5).faceResults;
    const second = playThroughWithFaces(synthetic(100, 240), 2, 0.5).faceResults;
    expect(first).toEqual(second);
    expect(first).toContain('perfect');
    expect(first).toContain('miss');
  });
});
