import { newHandMenuState, stepHandMenu } from './handMenu';
import type { HandMenuState, HandMenuStep, HandTarget, MenuHand } from './handMenu';

/**
 * One pointer for each player. Each player's hands step a hand-menu state of their own (see
 * handMenu.ts), so two players can hover and hold on two items at the same time, and neither
 * blocks the other: two players rate the cue set at once, each on any card.
 *
 * Where the pointers meet, the players act as one:
 * - Two players on one item show one highlight, with the mark of the hold that is further along.
 * - A frame chooses an item at most once, and its choices come in player order.
 * - When one player's hold chooses an item, the holds of the other players on that item are
 *   spent too: one action, not two. On an item that steps through a list, their holds start
 *   again with the chooser's, so the list steps once for each hold time.
 */

/** An item that a pointer is on, and how far the hold that is furthest along on it has come, 0..1. */
export interface ItemHover {
  id: string;
  progress: number;
}

export interface PointersStep {
  /** The state of each player's pointer, in player order. */
  states: HandMenuState[];
  /** One entry for each item that a pointer is on, in player order. */
  hovers: ItemHover[];
  /** The items to choose on this frame, in player order, each once. */
  chooseIds: string[];
}

/** The pointers of `count` players, on no item. */
export function newPlayerPointers(count: number): HandMenuState[] {
  return Array.from({ length: count }, newHandMenuState);
}

/**
 * Advances every player's pointer by one tracking frame. `handsByPlayer` holds the hands of
 * each player, in player order. A player with no hands keeps a hover only through a short gap
 * in tracking, as one pointer does. Never mutates `states`.
 */
export function stepPlayerPointers(
  states: readonly HandMenuState[],
  targets: readonly HandTarget[],
  handsByPlayer: readonly (readonly MenuHand[])[],
  nowMs: number,
): PointersStep {
  const steps = handsByPlayer.map((hands, player) =>
    stepHandMenu(states[player] ?? newHandMenuState(), targets, hands, nowMs),
  );
  const chooseIds = [...new Set(steps.flatMap((step) => (step.chooseId ? [step.chooseId] : [])))];
  const nextStates = steps.map((step) => spendJoinedHold(step, chooseIds, targets, nowMs));
  return { states: nextStates, hovers: mergeHovers(steps), chooseIds };
}

/**
 * The state of a player who holds on an item that another player chose on this frame: the
 * hold is spent with the choice. On an item that repeats it starts again, as the chooser's
 * does. On any other item it chooses nothing more until the fist opens.
 */
function spendJoinedHold(
  step: HandMenuStep,
  chooseIds: readonly string[],
  targets: readonly HandTarget[],
  nowMs: number,
): HandMenuState {
  const { state } = step;
  if (step.chooseId !== null || state.holdStartedMs === null) return state;
  if (state.hoveredId === null || !chooseIds.includes(state.hoveredId)) return state;
  const repeats = targets.find((target) => target.id === state.hoveredId)?.repeats === true;
  return repeats ? { ...state, holdStartedMs: nowMs } : { ...state, chosen: true };
}

/** One hover for each item that a pointer is on, with the hold that is furthest along. */
function mergeHovers(steps: readonly HandMenuStep[]): ItemHover[] {
  const hovers: ItemHover[] = [];
  for (const step of steps) {
    const id = step.state.hoveredId;
    if (id === null) continue;
    const same = hovers.find((hover) => hover.id === id);
    if (same) same.progress = Math.max(same.progress, step.progress);
    else hovers.push({ id, progress: step.progress });
  }
  return hovers;
}

/**
 * Chooses the items of one frame, in order. It stops once a choice has changed what the hands
 * point at, `screen`: a new phase, a new panel, or the video player. The later choices of the
 * frame were made on the screen before. A change inside the same panel does not stop it: one
 * player steps the songs while the other picks a level.
 */
export function chooseInTurn(ids: readonly string[], choose: (id: string) => void, screen: () => string): void {
  if (ids.length === 0) return;
  const before = screen();
  for (const id of ids) {
    if (screen() !== before) return;
    choose(id);
  }
}
