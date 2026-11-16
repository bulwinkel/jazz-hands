import { MOVE_NAMES } from './moves';
import type { MoveName } from './moves';
import type { Level, PlayerIndex } from './types';

/** The heading of the results: on the results screen, and on the end card of the game view. */
export const RESULTS_HEADING = 'What a dance! 🎉';

/**
 * The line of the results that asks for a replay. The Start cell lies under the results panel,
 * so the line says where to hold: the screen is a mirror, so the top-right cell is high to the
 * player's right.
 */
export const REPLAY_PROMPT = 'Hold a hand high to your right to play again 🙌';

/** A player's heading in the results, for example "Player 1 · Level 3". */
export function playerHeading(player: { index: PlayerIndex; level: Level }): string {
  return `Player ${player.index + 1} · Level ${player.level}`;
}

/**
 * The round's cue set in the results, for example "🎲 Set 3". The players see which set they
 * played, also when the game picked it. Null for a round with no set: a seed from the URL.
 */
export function cueSetLine(set: number | null): string | null {
  return set === null ? null : `🎲 Set ${set}`;
}

/**
 * The moves of a player's chart in the results, for example "3 points · 1 circle". A move the
 * chart does not hold is left out. Null for a chart with no moves.
 */
export function movesLine(moves: Readonly<Record<MoveName, number>>): string | null {
  const held = MOVE_NAMES.filter((name) => moves[name] > 0);
  if (held.length === 0) return null;
  const counts = held.map((name) => countOf(moves[name], name));
  return counts.join(' · ');
}

/** A count and a name, for example "1 point" or "2 points". */
function countOf(count: number, name: string): string {
  return count === 1 ? `1 ${name}` : `${count} ${name}s`;
}
