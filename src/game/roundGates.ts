import type { Phase } from './types';

/**
 * When a round may start from its 3-2-1 countdown: from the ready screen, from the results to
 * play again, or from play to start again. Not while a new tracker loads after the M key: the
 * round would start again while the tracker still loads, and Pause would not work until the
 * load ends. Recalibrating waits for the same reason.
 */
export function canBeginCountdown(phase: Phase, switchingTracker: boolean): boolean {
  if (switchingTracker) return false;
  return phase === 'ready' || phase === 'results' || phase === 'play';
}
