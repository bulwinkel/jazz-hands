import type { PlayerTracking, TrackedHand } from '../tracking/types';
import { randomSequence } from './chart';
import { GAME_CONFIG as C } from './config';
import { cellCentre } from './geometry';
import type { Cue, Phase, Rect } from './types';
export function botHits(cue: Cue, accuracy: number, seed: number): boolean {
  return randomSequence(seed ^ Math.imul(cue.beatIndex + 1, 0x45d9f3b))() < accuracy;
}
function hand(grid: Rect, cell: number, gesture: TrackedHand['gesture'] = 'open'): TrackedHand {
  return { ...cellCentre(grid, cell), size: 0.05, gesture, gestureScore: 1 };
}
export function botPlayer(phase: Phase, time: number, cues: Cue[], grid: Rect, active: boolean, accuracy: number, seed: number): PlayerTracking {
  if (!active) return { hands: [] };
  if (phase === 'ready' || phase === 'results') return { hands: [hand(grid, 1)] };
  if (phase !== 'play') return { hands: [] };
  const cue = cues.find(c => time >= c.timeSec - C.botLeadSec && time <= c.timeSec + C.botHoldSec && botHits(c, accuracy, seed));
  return { hands: cue ? cue.cells.map(cell => hand(grid, cell, cue.gesture)) : [] };
}
