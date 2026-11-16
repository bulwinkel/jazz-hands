import { describe, expect, it } from 'vitest';
import type { TrackedFace, TrackedHand, TrackingFrame } from '../tracking/types';
import { newFaceObservation, newObservation } from './diagnostics';
import { newFaceCueState } from './faceJudgment';
import { cellRect } from './geometry';
import { closingSongTime, frameSongTime, newCueState } from './judgment';
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

const tap = (cell: number, timeSec: number): Cue => ({ timeSec, beatIndex: 0, cells: [cell], times: [timeSec] });

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

  it('judges, scores and flashes each cell of a slide on its own: a missed middle cell is one Miss', () => {
    // A slide across the middle row, one cell a beat apart at 100 BPM.
    const slide: Cue[] = [
      { ...tap(3, 10), slideStep: 1 },
      { ...tap(4, 10.6), slideStep: 2 },
      { ...tap(5, 11.2), slideStep: 3 },
    ];
    const player = playerWith(slide);
    const first = judgePlayers([player], 10, frameWith([handIn(player, 3)]), 1);
    // The hand skips the middle cell: its window closes with no hit.
    const second = judgePlayers([player], 11.2, frameWith([handIn(player, 5)]), 2);
    const rest = judgePlayers([player], 12, undefined, 3);
    expect(first).toEqual([{ player: 0, target: 3, result: 'perfect', atMs: 1 }]);
    expect(second).toEqual([
      { player: 0, target: 4, result: 'miss', atMs: 2 },
      { player: 0, target: 5, result: 'perfect', atMs: 2 },
    ]);
    expect(rest).toEqual([]);
    expect(player.states.map((state) => state.result)).toEqual(['perfect', 'miss', 'perfect']);
    expect(player.score).toMatchObject({ perfect: 2, good: 0, miss: 1, total: 3, combo: 1 });
  });

  it('flashes a double tap on both of its cells', () => {
    const double: Cue = { timeSec: 10, beatIndex: 0, cells: [3, 5], times: [10, 10] };
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

describe('a frame that a tracking worker delivers late', () => {
  /**
   * Level 3: a hand enters the cell 320 ms after the beat, and the Good window ends at 350 ms.
   * The frame is taken at page time 1000 ms and reaches the game at 1060 ms. The draw loop
   * runs at 1030 and 1050 ms meanwhile, and at 1050 ms the song is past the window.
   */
  const BEAT_SEC = 10;
  const TAKEN_MS = 1000;
  const songAt = (nowMs: number): number => BEAT_SEC + 0.32 + (nowMs - TAKEN_MS) / 1000;

  function levelThreePlayer(): PlayerRun {
    const [player] = createPlayers(parseSettings(null, '?players=1&p0=3').settings);
    const cues = [tap(4, BEAT_SEC)];
    player.cues = cues;
    player.states = cues.map(newCueState);
    player.observations = cues.map(newObservation);
    return player;
  }

  function drawLoop(player: PlayerRun, nowMs: number, pendingFrameMs: number | undefined): void {
    judgePlayers([player], closingSongTime(songAt(nowMs), nowMs, 0, pendingFrameMs, 5000), undefined, nowMs);
  }

  function deliverFrame(player: PlayerRun, nowMs: number): void {
    const frame = { ...frameWith([handIn(player, 4)]), timeMs: TAKEN_MS };
    judgePlayers([player], frameSongTime(songAt(nowMs), nowMs, frame.timeMs, 0), frame, nowMs);
  }

  it('still scores when the draw loop passed the end of the window meanwhile', () => {
    const player = levelThreePlayer();
    drawLoop(player, 1030, TAKEN_MS);
    drawLoop(player, 1050, TAKEN_MS);
    expect(player.states[0].result).toBeUndefined();
    deliverFrame(player, 1060);
    drawLoop(player, 1070, undefined);
    expect(player.states[0].result).toBe('good');
  });

  it('was a miss when the draw loop did not wait for the frame', () => {
    const player = levelThreePlayer();
    drawLoop(player, 1030, undefined);
    drawLoop(player, 1050, undefined);
    deliverFrame(player, 1060);
    expect(player.states[0].result).toBe('miss');
  });
});
