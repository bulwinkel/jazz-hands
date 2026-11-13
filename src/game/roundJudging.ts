import type { TrackingFrame } from '../tracking/types';
import { LEVELS } from './config';
import { observeFaceFrame, observeFrame } from './diagnostics';
import { judgeFaceFrame } from './faceJudgment';
import { judgeFrame } from './judgment';
import type { CueState } from './judgment';
import type { PlayerRun } from './player';
import type { Feedback } from './render';
import { award } from './scoring';
import type { Rating } from './types';

/** What judging reads and changes of a player. */
export type JudgedPlayer = Pick<
  PlayerRun,
  'index' | 'level' | 'grid' | 'states' | 'observations' | 'faceStates' | 'faceObservations' | 'score'
>;

/**
 * Judges every open cue of the players at song time `timeSec`: hand cues and face cues. It
 * changes each player's cue states, observations and score in place, and returns a flash for
 * each cue that became final, at clock time `atMs`. With no frame, it only closes cues whose
 * time has passed.
 */
export function judgePlayers(
  players: readonly JudgedPlayer[],
  timeSec: number,
  frame: TrackingFrame | undefined,
  atMs: number,
): Feedback[] {
  return players.flatMap((player) => [
    ...judgeHandCues(player, timeSec, frame, atMs),
    ...judgeFaceCues(player, timeSec, frame, atMs),
  ]);
}

function judgeHandCues(player: JudgedPlayer, timeSec: number, frame: TrackingFrame | undefined, atMs: number): Feedback[] {
  const feedback: Feedback[] = [];
  const hands = frame?.players[player.index].hands ?? [];
  const opensAheadSec = -LEVELS[player.level].goodMs[0] / 1000;
  for (let i = 0; i < player.states.length; i++) {
    const state = player.states[i];
    if (state.cue.timeSec - opensAheadSec > timeSec) break; // This cue and all later ones are not open yet.
    if (frame) observeFrame(player.observations[i], state.cue, player.level, player.grid, hands, timeSec);
    if (state.result) continue;
    const next = judgeFrame(state, player.level, player.grid, hands, timeSec);
    player.states[i] = next;
    if (next.result) feedback.push(...awardCue(player, next, next.result, atMs));
  }
  return feedback;
}

/** The same as for hand cues: with no frame, it only closes cues whose time has passed. */
function judgeFaceCues(player: JudgedPlayer, timeSec: number, frame: TrackingFrame | undefined, atMs: number): Feedback[] {
  const feedback: Feedback[] = [];
  const face = frame?.players[player.index].face;
  const opensAheadSec = -LEVELS[player.level].goodMs[0] / 1000;
  for (let i = 0; i < player.faceStates.length; i++) {
    const state = player.faceStates[i];
    if (state.cue.timeSec - opensAheadSec > timeSec) break; // This cue and all later ones are not open yet.
    if (frame) observeFaceFrame(player.faceObservations[i], state.cue, player.level, face, timeSec);
    if (state.result) continue;
    const next = judgeFaceFrame(state, player.level, face, timeSec);
    player.faceStates[i] = next;
    if (next.result) feedback.push(awardFace(player, next.result, atMs));
  }
  return feedback;
}

/** Scores a hand cue. A slide shows its result where it ends. A tap shows it on each of its cells. */
function awardCue(player: JudgedPlayer, state: CueState, result: Rating, atMs: number): Feedback[] {
  player.score = award(player.score, result);
  const cells = state.cue.kind === 'slide' ? state.cue.cells.slice(-1) : state.cue.cells;
  return cells.map((cell) => ({ player: player.index, target: cell, result, atMs }));
}

/** A face cue scores exactly like a hand cue. Its result shows on the player's face. */
function awardFace(player: JudgedPlayer, result: Rating, atMs: number): Feedback {
  player.score = award(player.score, result);
  return { player: player.index, target: 'face', result, atMs };
}
