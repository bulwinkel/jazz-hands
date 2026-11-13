/** Colour helpers for the game picture. Every colour is a `#rrggbb` string. */

import { clamp01 } from './numbers';

/** A cue has this colour on its beat. Before that, it fades toward it from the player's colour. */
export const DUE_COLOR = '#fde047';

/**
 * The veil over the camera picture, so the cues stand out. The screen puts it there (the
 * stylesheet takes it from ui.ts), and the game view of a recording draws the same one.
 */
export const VEIL = 'rgba(5, 7, 27, 0.4)';

const toHexByte = (value: number): string => Math.round(value).toString(16).padStart(2, '0');

/** A colour with an alpha from 0 to 1, as `#rrggbbaa`. */
export function withAlpha(color: string, alpha: number): string {
  return color + toHexByte(clamp01(alpha) * 255);
}

/** The colour part of the way from one colour to another: `share` 0 gives `from`, 1 gives `to`. */
export function mixColors(from: string, to: string, share: number): string {
  const t = clamp01(share);
  let mixed = '#';
  // Red, green and blue each start at this position in the string.
  for (const start of [1, 3, 5]) {
    const a = parseInt(from.slice(start, start + 2), 16);
    const b = parseInt(to.slice(start, start + 2), 16);
    mixed += toHexByte(a + (b - a) * t);
  }
  return mixed;
}

/**
 * The colour of a cue, which tells a player how soon the cue is due.
 * A cue appears in the player's colour and fades to the due colour, which it reaches on its
 * beat. With several cues on screen, the one nearest the due colour comes first.
 *
 * `remaining` is the share of the approach time still to go: 1 when the cue appears, 0 on its beat.
 */
export function cueColor(playerColor: string, remaining: number): string {
  return mixColors(playerColor, DUE_COLOR, 1 - remaining);
}
