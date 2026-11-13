/**
 * The timing mark of a cue, which shows when its beat comes: a block starts small in the
 * middle of the cell and grows. It fills the cell on the beat. It never leaves its cell, and
 * two cues for one cell show as a small block on a large one: the large one comes first.
 *
 * The fist hold in the menu uses the same mark, so the menu teaches how a round reads.
 */
import { GROW_START_SCALE } from './config';
import { clamp01 } from './numbers';

/**
 * The size of a cue's timing mark, as a multiple of its cell's size.
 * `remaining` is the share of the approach time still to go: 1 when the cue appears, 0 on its
 * beat. The mark is exactly the size of the cell on the beat, and stays so after.
 */
export function markScale(remaining: number): number {
  const left = clamp01(remaining);
  return GROW_START_SCALE + (1 - GROW_START_SCALE) * (1 - left);
}
