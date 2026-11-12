import type { Point, Rect } from './types';

/**
 * Choosing menu items by hand. An open hand moves a cursor and highlights the item under it.
 * A fist held on the item chooses it. Moving and choosing are two different shapes, so a hand
 * that only passes over an item, or rests on it, never chooses it.
 *
 * This module is the rule only. It knows nothing about the page: the caller gives it the
 * items as rectangles and the hands as points, both in screen pixels, on every tracking frame.
 */

export interface HandTarget {
  id: string;
  rect: Rect;
  /** How long a fist must stay on this item to choose it. */
  holdSec: number;
}

export interface MenuHand extends Point {
  /** True while the hand is a fist. */
  fist: boolean;
}

export interface HandMenuState {
  /** The item a hand is on, or null. */
  hoveredId: string | null;
  /** When a hand was last seen on the hovered item. */
  lastOnTargetMs: number;
  /** When the current fist hold began, or null while no fist is on the item. */
  holdStartedMs: number | null;
  /** When a fist was last seen on the hovered item. */
  lastFistMs: number;
  /** True once this hold has chosen the item. The fist must open before it can choose again. */
  chosen: boolean;
}

export interface HandMenuStep {
  state: HandMenuState;
  /** How far the fist hold on the hovered item has come, 0..1. */
  progress: number;
  /** The item to choose on this frame, or null. */
  chooseId: string | null;
}

/**
 * Tracking loses a hand, or misreads a fist, for a frame or two now and then. A hover and a
 * hold both survive a gap this long, so a flicker does not send the player back to the start.
 */
const GAP_MS = 250;
/** A hand counts as on an item this far outside its edge, in pixels. Jitter then does not break a hold. */
const TARGET_MARGIN_PX = 10;

export function newHandMenuState(): HandMenuState {
  return { hoveredId: null, lastOnTargetMs: 0, holdStartedMs: null, lastFistMs: 0, chosen: false };
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

/** Which item is hovered now: the same one while a hand stays on it, else the first under a hand. */
function hoverAt(
  state: HandMenuState,
  targets: readonly HandTarget[],
  hands: readonly MenuHand[],
  nowMs: number,
): { target: HandTarget | undefined; handsOnIt: MenuHand[]; isNew: boolean } {
  const handsOn = (target: HandTarget): MenuHand[] => hands.filter((hand) => isOn(target, hand));
  const current = targets.find((target) => target.id === state.hoveredId);

  if (current && handsOn(current).length > 0) return { target: current, handsOnIt: handsOn(current), isNew: false };
  const next = targets.find((target) => handsOn(target).length > 0);
  if (next) return { target: next, handsOnIt: handsOn(next), isNew: true };
  // No hand on any item: keep the hover through a short gap in tracking.
  const withinGap = current !== undefined && nowMs - state.lastOnTargetMs <= GAP_MS;
  return { target: withinGap ? current : undefined, handsOnIt: [], isNew: false };
}

/** Advances the menu by one tracking frame. Never mutates `state`. */
export function stepHandMenu(
  state: HandMenuState,
  targets: readonly HandTarget[],
  hands: readonly MenuHand[],
  nowMs: number,
): HandMenuStep {
  const { target, handsOnIt, isNew } = hoverAt(state, targets, hands, nowMs);
  if (!target) return { state: newHandMenuState(), progress: 0, chooseId: null };

  // A hold belongs to one item. On a new item it starts from nothing.
  const before = isNew ? { ...newHandMenuState(), hoveredId: target.id } : state;
  const next: HandMenuState = {
    ...before,
    lastOnTargetMs: handsOnIt.length > 0 ? nowMs : before.lastOnTargetMs,
  };

  const fistOnIt = handsOnIt.some((hand) => hand.fist);
  if (fistOnIt) {
    next.holdStartedMs = before.holdStartedMs ?? nowMs;
    next.lastFistMs = nowMs;
  } else if (before.holdStartedMs !== null && nowMs - before.lastFistMs > GAP_MS) {
    // The fist opened, or left: the hold is over, and the next fist may choose again.
    next.holdStartedMs = null;
    next.chosen = false;
  }

  if (next.holdStartedMs === null) return { state: next, progress: 0, chooseId: null };
  const progress = Math.min(1, (nowMs - next.holdStartedMs) / (target.holdSec * 1000));
  // Choose only on a frame that really shows a fist, never inside a tracking gap.
  const chooseNow = fistOnIt && progress >= 1 && !next.chosen;
  next.chosen = next.chosen || chooseNow;
  return { state: next, progress, chooseId: chooseNow ? target.id : null };
}
