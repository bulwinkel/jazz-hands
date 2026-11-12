import type { TrackedHand } from '../tracking/types';
import { GAME_CONFIG as C } from './config';
import { cellRect, insideCell } from './geometry';
import type { Cue, Level, Rating, Rect } from './types';
export interface CueState { cue: Cue; cells: ('perfect' | 'good' | null)[]; result?: Rating }
export function cueState(cue: Cue): CueState { return { cue, cells: cue.cells.map(() => null) }; }
export function frameSongTime(songTimeNow: number, nowMs: number, frameTimeMs: number, inputLatencyMs: number): number {
  return songTimeNow - (nowMs - frameTimeMs) / 1000 - inputLatencyMs / 1000;
}
/** Keep Good provisional so early-and-hold play can upgrade to Perfect. */
export function judgeFrame(state: CueState, level: Level, grid: Rect, hands: TrackedHand[], time: number): CueState {
  if (state.result) return state;
  const next: CueState = { ...state, cells: [...state.cells] };
  const delta = (time - state.cue.timeSec) * 1000; const w = C.windows[level]; const e = 1e-6;
  if (delta >= w.good[0] - e && delta <= w.good[1] + e) {
    for (let i = 0; i < next.cells.length; i++) {
      if (next.cells[i] === 'perfect') continue;
      if (!hands.some(h => insideCell(h, cellRect(grid, state.cue.cells[i])) && (!state.cue.gesture || h.gesture === 'unknown' || h.gesture === state.cue.gesture))) continue;
      next.cells[i] = delta >= w.perfect[0] - e && delta <= w.perfect[1] + e ? 'perfect' : next.cells[i] ?? 'good';
    }
  }
  if (next.cells.every(c => c === 'perfect')) next.result = 'perfect';
  else if (delta > w.good[1] + e) next.result = next.cells.some(c => c === null) ? 'miss' : 'good';
  return next;
}
