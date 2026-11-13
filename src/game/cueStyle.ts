/**
 * How a cue shows when its beat comes. The players can step through the styles to compare
 * them: with the V key, or with the switch in the menu.
 *
 * - `shrink`: an outline starts well outside the cell and shrinks onto its border. It meets
 *   the border on the beat. With many cues on screen, the outlines of different cells cross.
 * - `grow`: a block starts small in the middle of the cell and grows. It fills the cell on
 *   the beat. It never leaves its cell, and two cues for one cell show as a small block on a
 *   large one: the large one comes first.
 *
 * The fist hold in the menu uses the same mark, so the menu teaches how a round reads.
 */
import { GROW_START_SCALE, SHRINK_START_SCALE } from './config';
import { clamp01 } from './numbers';

export type CueStyle = 'shrink' | 'grow';

export const CUE_STYLES: readonly CueStyle[] = ['shrink', 'grow'];

export const CUE_STYLE_NAMES: Record<CueStyle, string> = { shrink: 'Shrink', grow: 'Grow' };

export function isCueStyle(value: unknown): value is CueStyle {
  return CUE_STYLES.includes(value as CueStyle);
}

/** The style after this one. After the last comes the first. */
export function nextCueStyle(style: CueStyle): CueStyle {
  return CUE_STYLES[(CUE_STYLES.indexOf(style) + 1) % CUE_STYLES.length];
}

/**
 * The size of a cue's timing mark, as a multiple of its cell's size.
 * `remaining` is the share of the approach time still to go: 1 when the cue appears, 0 on its
 * beat. In both styles the mark is exactly the size of the cell on the beat, and stays so after.
 */
export function markScale(style: CueStyle, remaining: number): number {
  const left = clamp01(remaining);
  if (style === 'grow') return GROW_START_SCALE + (1 - GROW_START_SCALE) * (1 - left);
  return 1 + (SHRINK_START_SCALE - 1) * left;
}
