import type { Level, PlayerIndex } from './types';

/** The heading of the results: on the results screen, and on the end card of the game view. */
export const RESULTS_HEADING = 'What a dance! 🎉';

/** A player's heading in the results, for example "Player 1 · Level 3". */
export function playerHeading(player: { index: PlayerIndex; level: Level }): string {
  return `Player ${player.index + 1} · Level ${player.level}`;
}
