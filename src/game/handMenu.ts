import type { Point, Rect } from './types';

/**
 * Selecting menu items by pointing: a hand held over an item for a moment presses it.
 *
 * This module is the rule only. It knows nothing about the page: the caller gives it the
 * items as rectangles and the hands as points, both in screen pixels, on every tracking frame.
 */

export interface HandTarget {
  id: string;
  rect: Rect;
  /** How long a hand must stay on this item to press it. */
  dwellSec: number;
}

export interface HandMenuState {
  /** The item a hand is on, or null. */
  hoveredId: string | null;
  hoverStartedMs: number;
  /** When a hand was last seen on the hovered item. */
  lastOnTargetMs: number;
  /** True once the hovered item was pressed. The hand must leave before it can press again. */
  pressed: boolean;
}

export interface HandMenuStep {
  state: HandMenuState;
  /** How far the hold on the hovered item has come, 0..1. */
  progress: number;
  /** The item to press on this frame, or null. */
  pressId: string | null;
}

/**
 * Tracking loses a hand for a frame or two now and then. A hold survives a gap this long,
 * so a flicker does not send the player back to the start of the hold.
 */
const HOLD_GAP_MS = 250;
/** A hand counts as on an item this far outside its edge, in pixels. Jitter then does not break a hold. */
const TARGET_MARGIN_PX = 10;

export function newHandMenuState(): HandMenuState {
  return { hoveredId: null, hoverStartedMs: 0, lastOnTargetMs: 0, pressed: false };
}

function isOn(target: HandTarget, hand: Point): boolean {
  const { rect } = target;
  return (
    hand.x >= rect.x - TARGET_MARGIN_PX &&
    hand.x <= rect.x + rect.width + TARGET_MARGIN_PX &&
    hand.y >= rect.y - TARGET_MARGIN_PX &&
    hand.y <= rect.y + rect.height + TARGET_MARGIN_PX
  );
}

/** Advances the menu by one tracking frame. Never mutates `state`. */
export function stepHandMenu(
  state: HandMenuState,
  targets: readonly HandTarget[],
  hands: readonly Point[],
  nowMs: number,
): HandMenuStep {
  const isUnderAHand = (target: HandTarget): boolean => hands.some((hand) => isOn(target, hand));
  const current = targets.find((target) => target.id === state.hoveredId);

  // A hand is still on the hovered item: the hold continues.
  if (current && isUnderAHand(current)) {
    const progress = Math.min(1, (nowMs - state.hoverStartedMs) / (current.dwellSec * 1000));
    const pressNow = progress >= 1 && !state.pressed;
    return {
      state: { ...state, lastOnTargetMs: nowMs, pressed: state.pressed || pressNow },
      progress,
      pressId: pressNow ? current.id : null,
    };
  }

  // A hand is on another item: a new hold starts there.
  const next = targets.find(isUnderAHand);
  if (next) {
    return {
      state: { hoveredId: next.id, hoverStartedMs: nowMs, lastOnTargetMs: nowMs, pressed: false },
      progress: 0,
      pressId: null,
    };
  }

  // No hand on any item. Keep the hold through a short gap, then drop it.
  if (current && nowMs - state.lastOnTargetMs <= HOLD_GAP_MS) {
    const progress = Math.min(1, (nowMs - state.hoverStartedMs) / (current.dwellSec * 1000));
    return { state, progress: state.pressed ? 1 : progress, pressId: null };
  }
  return { state: newHandMenuState(), progress: 0, pressId: null };
}
