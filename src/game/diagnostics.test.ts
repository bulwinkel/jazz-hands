import { describe, expect, it } from 'vitest';
import type { FaceExpression, GestureName, TrackedFace, TrackedHand } from '../tracking/types';
import { FACES, LEVELS } from './config';
import {
  buildRunReport,
  newFaceObservation,
  newObservation,
  newTrackingStats,
  observeFaceFrame,
  observeFrame,
} from './diagnostics';
import type { RunContext } from './diagnostics';
import { judgeFaceFrame, newFaceCueState } from './faceJudgment';
import { cellCentre, defaultGrid } from './geometry';
import { judgeFrame, newCueState } from './judgment';
import type { PlayerRun } from './player';
import { freshScore } from './scoring';
import type { Cue, FaceCue } from './types';

const grid = defaultGrid(0, 1);
const LEVEL = 2;
const FRAME_SEC = 1 / 30;

function hand(cell: number, gesture: GestureName = 'open'): TrackedHand {
  return { ...cellCentre(grid, cell), gesture, size: 0.05, gestureScore: 1 };
}

/** A single tap on cell 4, due at 1 s. */
function tap(gesture?: GestureName): Cue {
  return { kind: 'tap', timeSec: 1, beatIndex: 2, cells: [4], times: [1], gesture };
}

/** A player with no cues yet. */
function newPlayer(): PlayerRun {
  return {
    index: 0,
    level: LEVEL,
    shapes: false,
    faces: false,
    grid,
    reachSamples: [],
    cues: [],
    states: [],
    observations: [],
    faceCues: [],
    faceStates: [],
    faceObservations: [],
    faceSeenAt: null,
    score: freshScore(),
    holdStartMs: null,
    hold: 0,
  };
}

/** A player who met one cue. `handsAt` says which hands the tracker saw at each frame time. */
function playOneCue(cue: Cue, handsAt: (timeSec: number) => TrackedHand[]): PlayerRun {
  const player: PlayerRun = {
    ...newPlayer(),
    shapes: cue.gesture !== undefined,
    cues: [cue],
    states: [newCueState(cue)],
    observations: [newObservation(cue)],
  };
  for (let timeSec = 0; timeSec < 2; timeSec += FRAME_SEC) {
    const hands = handsAt(timeSec);
    observeFrame(player.observations[0], cue, LEVEL, grid, hands, timeSec);
    player.states[0] = judgeFrame(player.states[0], LEVEL, grid, hands, timeSec);
  }
  return player;
}

/** A face that shows one expression at the given strength, and no other. */
function face(expression: FaceExpression, strength: number): TrackedFace {
  return { x: 0.5, y: 0.3, expressions: { smile: 0, openMouth: 0, pucker: 0, [expression]: strength } };
}

function faceCue(expression: FaceExpression, timeSec: number): FaceCue {
  return { timeSec, beatIndex: 2, expression };
}

/** A player who met these face cues. `faceAt` says which face the tracker saw at each frame time. */
function playFaceCues(cues: FaceCue[], faceAt: (timeSec: number) => TrackedFace | undefined): PlayerRun {
  const player: PlayerRun = {
    ...newPlayer(),
    faces: true,
    faceCues: cues,
    faceStates: cues.map(newFaceCueState),
    faceObservations: cues.map(newFaceObservation),
  };
  const endSec = Math.max(...cues.map((cue) => cue.timeSec)) + 1;
  for (let timeSec = 0; timeSec < endSec; timeSec += FRAME_SEC) {
    const tracked = faceAt(timeSec);
    cues.forEach((cue, i) => {
      observeFaceFrame(player.faceObservations[i], cue, LEVEL, tracked, timeSec);
      player.faceStates[i] = judgeFaceFrame(player.faceStates[i], LEVEL, tracked, timeSec);
    });
  }
  return player;
}

function report(players: PlayerRun[], stats = newTrackingStats(0), faceDelegate: string | null = null) {
  const context: RunContext = {
    song: { id: 'synthetic', title: 'Test', length: 'short', startSec: 0, endSec: 2 },
    settings: { playerCount: 1, input: 'bot', seed: 1, inputLatencyMs: 100, avOffsetMs: 0, audioOutputLatencyMs: 20 },
    trackerMode: 'hands-full',
    trackerDelegate: 'GPU',
    trackerFaceDelegate: faceDelegate,
    players,
    stats,
    nowMs: 2000,
  };
  return buildRunReport(context);
}

describe('observing a cue', () => {
  it('counts only frames inside the Good window', () => {
    const player = playOneCue(tap(), () => [hand(4)]);
    const [goodEarly, goodLate] = LEVELS[LEVEL].goodMs;
    const framesInWindow = Math.round((goodLate - goodEarly) / 1000 / FRAME_SEC);
    const [cell] = player.observations[0].cells;
    expect(player.observations[0].frames).toBeGreaterThanOrEqual(framesInWindow - 1);
    expect(player.observations[0].frames).toBeLessThanOrEqual(framesInWindow + 1);
    expect(cell.framesInCell).toBe(player.observations[0].frames);
    expect(cell.framesMatching).toBe(cell.framesInCell);
  });

  it('keeps counting after the cue is final, to the end of the window', () => {
    const player = playOneCue(tap(), () => [hand(4)]);
    expect(player.states[0].result).toBe('perfect');
    expect(player.observations[0].cells[0].framesInCell).toBeGreaterThan(10);
  });

  it('records when the hand arrived, relative to the due time', () => {
    const player = playOneCue(tap(), (timeSec) => (timeSec >= 1.1 ? [hand(4)] : []));
    const { firstInCellMs } = player.observations[0].cells[0];
    expect(firstInCellMs).toBeGreaterThanOrEqual(100);
    expect(firstInCellMs).toBeLessThan(100 + FRAME_SEC * 1000 + 1);
  });

  it('ignores a hand in another cell', () => {
    const player = playOneCue(tap(), () => [hand(0)]);
    expect(player.observations[0].cells[0]).toMatchObject({ framesInCell: 0, firstInCellMs: null });
    expect(player.states[0].result).toBe('miss');
  });

  it('tells a wrong shape in the right cell from the right shape', () => {
    const player = playOneCue(tap('fist'), () => [hand(4, 'open')]);
    const observation = player.observations[0];
    expect(observation.cells[0].framesInCell).toBeGreaterThan(10);
    expect(observation.cells[0].framesMatching).toBe(0);
    expect(observation.cells[0].firstMatchMs).toBeNull();
    expect(observation.shapesRead).toEqual({ open: observation.cells[0].framesInCell });
    expect(player.states[0].result).toBe('miss');
  });
});

describe('run report', () => {
  it('shows a shape cue that was read correctly all the time', () => {
    const { shapeCues } = report([playOneCue(tap('fist'), () => [hand(4, 'fist')])]).players[0];
    expect(shapeCues).toMatchObject({ asked: 1, hit: 1, readAsAsked: 1, hitOnFewFrames: 0 });
    expect(Object.keys(shapeCues.readings.fist ?? {})).toEqual(['fist']);
  });

  it('flags a shape cue that passed on a single frame of the right shape', () => {
    // The tracker reads "open" all the time, except one frame of "fist" on the beat.
    const flicker = (timeSec: number) => [hand(4, Math.abs(timeSec - 1) < FRAME_SEC / 2 ? 'fist' : 'open')];
    const { shapeCues } = report([playOneCue(tap('fist'), flicker)]).players[0];
    expect(shapeCues.hit).toBe(1);
    expect(shapeCues.hitOnFewFrames).toBe(1);
    expect(shapeCues.readAsAsked).toBeLessThan(0.1);
    expect(shapeCues.readings.fist?.open).toBeGreaterThan(10);
  });

  it('reports how late hands arrive, and leaves out hands that were already waiting', () => {
    const late = report([playOneCue(tap(), (timeSec) => (timeSec >= 1.1 ? [hand(4)] : []))]).players[0];
    expect(late.arrivalMs.cells).toBe(1);
    expect(late.arrivalMs.mean).toBeGreaterThanOrEqual(100);

    const waiting = report([playOneCue(tap(), () => [hand(4)])]).players[0];
    expect(waiting.arrivalMs).toEqual({ mean: null, median: null, cells: 0 });
  });

  it('reports how steady tracking was', () => {
    const stats = newTrackingStats(0);
    stats.frames = 60;
    stats.inferenceMs = Array.from({ length: 60 }, (_, i) => (i < 57 ? 20 : 50));
    stats.handCounts[0] = [6, 12, 42];
    const run = report([playOneCue(tap(), () => [hand(4)])], stats);
    expect(run.tracking).toMatchObject({ frames: 60, framesPerSec: 30, inferenceMs: { mean: 21.5, p95: 50 } });
    expect(run.players[0].handsSeen).toEqual({ none: 0.1, one: 0.2, two: 0.7 });
  });

  it('lists every cue with its result and what the tracker showed', () => {
    const [cue] = report([playOneCue(tap('fist'), () => [hand(4, 'fist')])]).players[0].cues;
    expect(cue).toMatchObject({ kind: 'tap', gesture: 'fist', result: 'perfect', marks: ['perfect'] });
    expect(cue.observation.cells[0].framesMatching).toBeGreaterThan(10);
  });
});

describe('observing a face cue', () => {
  const smile = faceCue('smile', 1);
  const [goodEarly, goodLate] = LEVELS[LEVEL].goodMs;
  const framesInWindow = Math.round((goodLate - goodEarly) / 1000 / FRAME_SEC);

  it('counts the frames inside the Good window, and keeps counting after the cue is final', () => {
    const player = playFaceCues([smile], () => face('smile', 0.9));
    const [observation] = player.faceObservations;
    expect(player.faceStates[0].result).toBe('perfect');
    expect(observation.frames).toBeGreaterThanOrEqual(framesInWindow - 1);
    expect(observation.frames).toBeLessThanOrEqual(framesInWindow + 1);
    expect(observation.framesWithFace).toBe(observation.frames);
    expect(observation.framesShowing).toBe(observation.frames);
  });

  it('records the highest strength of the asked-for expression and of each other one', () => {
    // The smile grows to 0.7 on the beat. The mouth is a little open all the time.
    const growing = (timeSec: number): TrackedFace => ({
      x: 0.5,
      y: 0.3,
      expressions: { smile: timeSec < 1 ? 0.2 : 0.7, openMouth: 0.3, pucker: 0 },
    });
    const [observation] = playFaceCues([smile], growing).faceObservations;
    expect(observation.peak).toBe(0.7);
    expect(observation.otherPeaks).toEqual({ openMouth: 0.3, pucker: 0 });
  });

  it('records when the expression first showed, relative to the due time', () => {
    const late = (timeSec: number): TrackedFace => face('smile', timeSec >= 1.1 ? 0.9 : 0.1);
    const { firstShownMs } = playFaceCues([smile], late).faceObservations[0];
    expect(firstShownMs).toBeGreaterThanOrEqual(100);
    expect(firstShownMs).toBeLessThan(100 + FRAME_SEC * 1000 + 1);
  });

  it('tells a face that was found from a face that showed the expression', () => {
    const tooWeak = FACES.thresholds.smile - 0.1;
    const player = playFaceCues([smile], () => face('smile', tooWeak));
    const [observation] = player.faceObservations;
    expect(observation.framesWithFace).toBeGreaterThan(10);
    expect(observation.framesShowing).toBe(0);
    expect(observation.firstShownMs).toBeNull();
    expect(observation.peak).toBeCloseTo(tooWeak);
    expect(player.faceStates[0].result).toBe('miss');
  });

  it('counts a frame with no face as a frame only', () => {
    const [observation] = playFaceCues([smile], () => undefined).faceObservations;
    expect(observation.frames).toBeGreaterThan(10);
    expect(observation).toMatchObject({ framesWithFace: 0, framesShowing: 0, peak: null, otherPeaks: {} });
  });
});

describe('face cues in the run report', () => {
  it('counts the face cues asked and hit', () => {
    const cues = [faceCue('smile', 1), faceCue('pucker', 3), faceCue('smile', 5)];
    // The player smiles all the time and never puckers.
    const { faces, faceCues } = report([playFaceCues(cues, () => face('smile', 0.9))]).players[0];
    expect(faces).toBe(true);
    expect(faceCues).toMatchObject({ asked: 3, hit: 2 });
  });

  it('gives each expression the median and the highest strength over its cues', () => {
    const cues = [faceCue('smile', 1), faceCue('smile', 3), faceCue('smile', 5), faceCue('pucker', 7)];
    // Three smiles of falling strength, then a pucker that stays under its threshold.
    const shown = (timeSec: number): TrackedFace => {
      if (timeSec < 2) return face('smile', 0.9);
      if (timeSec < 4) return face('smile', 0.6);
      if (timeSec < 6) return face('smile', 0.3);
      return face('pucker', 0.2);
    };
    const { expressions } = report([playFaceCues(cues, shown)]).players[0].faceCues;
    expect(expressions.smile).toEqual({
      asked: 3,
      hit: 2,
      threshold: FACES.thresholds.smile,
      medianPeak: 0.6,
      highestPeak: 0.9,
    });
    expect(expressions.pucker).toEqual({
      asked: 1,
      hit: 0,
      threshold: FACES.thresholds.pucker,
      medianPeak: 0.2,
      highestPeak: 0.2,
    });
    expect(expressions.openMouth).toBeUndefined(); // No cue asked for it.
  });

  it('takes the mean of the two middle cues when their count is even', () => {
    const cues = [faceCue('smile', 1), faceCue('smile', 3)];
    const shown = (timeSec: number): TrackedFace => face('smile', timeSec < 2 ? 0.9 : 0.6);
    const { expressions } = report([playFaceCues(cues, shown)]).players[0].faceCues;
    expect(expressions.smile?.medianPeak).toBe(0.75);
  });

  it('has no strength for an expression whose cues never had a face', () => {
    const { expressions } = report([playFaceCues([faceCue('smile', 1)], () => undefined)]).players[0].faceCues;
    expect(expressions.smile).toMatchObject({ asked: 1, hit: 0, medianPeak: null, highestPeak: null });
  });

  it('lists every face cue with its result and what the tracker showed', () => {
    const player = playFaceCues([faceCue('smile', 1)], () => face('smile', 0.9));
    const [listed] = report([player]).players[0].faceCues.cues;
    expect(listed).toMatchObject({ expression: 'smile', timeSec: 1, result: 'perfect' });
    expect(listed.observation.framesShowing).toBeGreaterThan(10);
    expect(listed.observation.peak).toBe(0.9);
  });

  it('is empty for a player with faces off', () => {
    const { faces, faceCues } = report([playOneCue(tap(), () => [hand(4)])]).players[0];
    expect(faces).toBe(false);
    expect(faceCues).toEqual({ asked: 0, hit: 0, expressions: {}, cues: [] });
  });

  it('names what the face models ran on, or null when none was loaded', () => {
    const player = playFaceCues([faceCue('smile', 1)], () => face('smile', 0.9));
    expect(report([player], newTrackingStats(0), 'GPU').tracking.faceDelegate).toBe('GPU');
    expect(report([player]).tracking.faceDelegate).toBeNull();
  });
});
