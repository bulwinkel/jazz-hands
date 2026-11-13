import { describe, expect, it } from 'vitest';
import type { TrackedFace, TrackedHand, TrackingFrame } from '../tracking/types';
import { newFaceObservation, newObservation } from './diagnostics';
import { newFaceCueState } from './faceJudgment';
import { cellRect } from './geometry';
import { newCueState } from './judgment';
import { createPlayers } from './player';
import type { PlayerRun } from './player';
import { judgePlayers } from './roundJudging';
import { parseSettings } from './settings';
import type { Cue, FaceCue } from './types';

/** One player on level 1, with these cues. */
function playerWith(cues: Cue[], faceCues: FaceCue[] = []): PlayerRun {
  const [player] = createPlayers(parseSettings(null, '?players=1&p0=1').settings);
  player.cues = cues;
  player.states = cues.map(newCueState);
  player.observations = cues.map(newObservation);
  player.faceCues = faceCues;
  player.faceStates = faceCues.map(newFaceCueState);
  player.faceObservations = faceCues.map(newFaceObservation);
  return player;
}

const tap = (cell: number, timeSec: number): Cue => ({ kind: 'tap', timeSec, beatIndex: 0, cells: [cell], times: [timeSec] });

/** A hand in the middle of one of the player's cells. */
function handIn(player: PlayerRun, cell: number): TrackedHand {
  const rect = cellRect(player.grid, cell);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, size: 0.05, gesture: 'open', gestureScore: 1 };
}

function frameWith(hands: TrackedHand[], face?: TrackedFace): TrackingFrame {
  return { timeMs: 0, inferenceMs: 0, players: [{ hands, face }, { hands: [] }] };
}

describe('judging a round', () => {
  it('scores a Perfect for a hand in the cell on the beat, and flashes it on that cell', () => {
    const player = playerWith([tap(4, 10)]);
    const feedback = judgePlayers([player], 10, frameWith([handIn(player, 4)]), 1234);
    expect(feedback).toEqual([{ player: 0, target: 4, result: 'perfect', atMs: 1234 }]);
    expect(player.states[0].result).toBe('perfect');
    expect(player.score).toMatchObject({ perfect: 1, total: 1, score: 100, combo: 1 });
    expect(player.observations[0].frames).toBe(1);
  });

  it('closes a cue as a Miss once its window has passed, also with no frame', () => {
    const player = playerWith([tap(4, 10)]);
    expect(judgePlayers([player], 10.2, frameWith([]), 0)).toEqual([]);
    expect(judgePlayers([player], 11, undefined, 50)).toEqual([{ player: 0, target: 4, result: 'miss', atMs: 50 }]);
    expect(player.score).toMatchObject({ miss: 1, total: 1, score: 0, combo: 0 });
  });

  it('leaves a cue that is not open yet alone', () => {
    const player = playerWith([tap(4, 10)]);
    expect(judgePlayers([player], 5, frameWith([handIn(player, 4)]), 0)).toEqual([]);
    expect(player.states[0]).toEqual(newCueState(tap(4, 10)));
    expect(player.observations[0].frames).toBe(0);
  });

  it('flashes a slide only where it ends', () => {
    const slide: Cue = { kind: 'slide', timeSec: 10, beatIndex: 0, cells: [3, 4, 5], times: [10, 10.5, 11] };
    const player = playerWith([slide]);
    judgePlayers([player], 10, frameWith([handIn(player, 3)]), 0);
    judgePlayers([player], 10.5, frameWith([handIn(player, 4)]), 0);
    const feedback = judgePlayers([player], 11, frameWith([handIn(player, 5)]), 0);
    expect(feedback).toEqual([{ player: 0, target: 5, result: 'perfect', atMs: 0 }]);
  });

  it('flashes a double tap on both of its cells', () => {
    const double: Cue = { kind: 'tap', timeSec: 10, beatIndex: 0, cells: [3, 5], times: [10, 10] };
    const player = playerWith([double]);
    const feedback = judgePlayers([player], 10, frameWith([handIn(player, 3), handIn(player, 5)]), 0);
    expect(feedback.map((item) => item.target)).toEqual([3, 5]);
  });

  it('scores a face cue like a hand cue and flashes it on the face', () => {
    const player = playerWith([], [{ timeSec: 10, beatIndex: 0, expression: 'smile' }]);
    const smile: TrackedFace = { x: 0.5, y: 0.3, expressions: { smile: 1, openMouth: 0, pucker: 0 } };
    const feedback = judgePlayers([player], 10, frameWith([], smile), 7);
    expect(feedback).toEqual([{ player: 0, target: 'face', result: 'perfect', atMs: 7 }]);
    expect(player.score).toMatchObject({ perfect: 1, total: 1 });
  });
});
