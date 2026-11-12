import { describe, expect, it } from 'vitest';
import type { GestureName, TrackedHand } from '../tracking/types';
import { LEVELS } from './config';
import { buildRunReport, newObservation, newTrackingStats, observeFrame } from './diagnostics';
import type { RunContext } from './diagnostics';
import { cellCentre, defaultGrid } from './geometry';
import { judgeFrame, newCueState } from './judgment';
import type { PlayerRun } from './player';
import { freshScore } from './scoring';
import type { Cue } from './types';

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

/** A player who met one cue. `handsAt` says which hands the tracker saw at each frame time. */
function playOneCue(cue: Cue, handsAt: (timeSec: number) => TrackedHand[]): PlayerRun {
  const player: PlayerRun = {
    index: 0,
    level: LEVEL,
    shapes: cue.gesture !== undefined,
    faces: false,
    grid,
    reachSamples: [],
    cues: [cue],
    states: [newCueState(cue)],
    observations: [newObservation(cue)],
    faceCues: [],
    faceStates: [],
    faceSeenAt: null,
    score: freshScore(),
    holdStartMs: null,
    hold: 0,
  };
  for (let timeSec = 0; timeSec < 2; timeSec += FRAME_SEC) {
    const hands = handsAt(timeSec);
    observeFrame(player.observations[0], cue, LEVEL, grid, hands, timeSec);
    player.states[0] = judgeFrame(player.states[0], LEVEL, grid, hands, timeSec);
  }
  return player;
}

function report(players: PlayerRun[], stats = newTrackingStats(0)) {
  const context: RunContext = {
    song: { id: 'synthetic', title: 'Test', length: 'short', startSec: 0, endSec: 2 },
    settings: { playerCount: 1, input: 'bot', seed: 1, inputLatencyMs: 100, avOffsetMs: 0, audioOutputLatencyMs: 20 },
    trackerMode: 'hands-full',
    trackerDelegate: 'GPU',
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
