import { GAP_MS } from './handMenu';
import type { MenuHand } from './handMenu';

/**
 * A fist that chooses an item stays a fist for a moment after the choice. When the choice
 * opens another screen, the pointers start again on that screen (see `setPhase` in flow.ts),
 * and the fist would start a new hold at once on whatever lies under it there: "✕ Close" of
 * the intro lies where the menu's Previews switch is. Within one screen, `chosen` in
 * handMenu.ts covers the same item, and `chooseInTurn` covers the same frame, but nothing
 * covers a fist held across a change of screen.
 *
 * So: when a choice by hand changes the screen, the fist of each player who shows a fist at
 * that moment is spent. A spent fist counts as an open hand: it moves the ring and the
 * highlight, and holds nothing. It is free again once that player has shown no fist for longer
 * than a gap in tracking (`GAP_MS`): a flicker of one frame does not free it, opening the hand
 * does. A player whose hand was open at the change is not touched.
 *
 * This module is the rule only. flow.ts keeps the state across screens, also across the reset
 * of the pointers.
 */

/** For each player: when their spent fist was last seen, or null for a player whose fist is free. */
export type SpentFists = readonly (number | null)[];

/** The hands of one frame as the pointers see them, and the spent fists after that frame. */
export interface SpentFistsStep {
  spent: SpentFists;
  /** Each player's hands. A spent fist shows here as an open hand. */
  hands: MenuHand[][];
}

/** No spent fist for any of `count` players. */
export function newSpentFists(count: number): SpentFists {
  return Array.from({ length: count }, () => null);
}

const showsFist = (hands: readonly MenuHand[]): boolean => hands.some((hand) => hand.fist);

/**
 * A choice by hand changed the screen at `nowMs`. The fist of each player who shows a fist now
 * is spent. Every other player keeps the state they had.
 */
export function spendFists(
  spent: SpentFists,
  handsByPlayer: readonly (readonly MenuHand[])[],
  nowMs: number,
): SpentFists {
  return handsByPlayer.map((hands, player) => (showsFist(hands) ? nowMs : (spent[player] ?? null)));
}

/**
 * Applies the spent fists to the hands of one frame, at `nowMs`. A player whose spent fist has
 * not shown for longer than `GAP_MS` is free again, so a fist they show now counts. A player
 * who is still spent shows open hands, and a fist they show keeps them spent. Never mutates
 * its arguments.
 */
export function withSpentFists(
  spent: SpentFists,
  handsByPlayer: readonly (readonly MenuHand[])[],
  nowMs: number,
): SpentFistsStep {
  const next: (number | null)[] = [];
  const hands: MenuHand[][] = [];
  handsByPlayer.forEach((playerHands, player) => {
    const lastFistMs = spent[player] ?? null;
    const isFree = lastFistMs === null || nowMs - lastFistMs > GAP_MS;
    if (isFree) {
      next.push(null);
      hands.push([...playerHands]);
      return;
    }
    next.push(showsFist(playerHands) ? nowMs : lastFistMs);
    hands.push(playerHands.map((hand) => ({ ...hand, fist: false })));
  });
  return { spent: next, hands };
}
