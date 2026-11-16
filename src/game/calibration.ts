import type { TrackingFrame } from '../tracking/types';
import { defaultGrid, fitGrid, hasReachToFit } from './geometry';
import type { PlayerRun } from './player';
import type { PlayerCount, PlayerIndex, Rect } from './types';

/**
 * A calibration fits a player's grid to their reach: the player draws big circles with both
 * arms, and the grid grows around their hands. Players start on the standard grid, or on the
 * grid of their last calibration. They calibrate only when they ask: a hand held in their
 * Calibrate cell on the ready screen, or the C key and the Recalibrate button of the results
 * for every player.
 */

/** What a calibration reads and changes of a player. */
export type CalibratedPlayer = Pick<PlayerRun, 'index' | 'grid' | 'calibrated' | 'reachSamples' | 'gridBeforeReach'>;

/**
 * The grids that calibrations gave, kept in memory until the page reloads. A new round from
 * the menu starts each player on the kept grid of their slot. Each player count keeps grids of
 * its own: the left player of two has half the frame, and one player alone has all of it.
 */
export class KeptGrids {
  private readonly grids = new Map<string, Rect>();

  /** Keeps the grid of a calibration that counted. */
  keep(player: PlayerIndex, playerCount: PlayerCount, grid: Rect): void {
    this.grids.set(gridKey(player, playerCount), { ...grid });
  }

  /** The kept grid of a slot, or undefined when that slot has none. */
  get(player: PlayerIndex, playerCount: PlayerCount): Rect | undefined {
    const grid = this.grids.get(gridKey(player, playerCount));
    return grid ? { ...grid } : undefined;
  }
}

function gridKey(player: PlayerIndex, playerCount: PlayerCount): string {
  return `${playerCount}:${player}`;
}

/** A new round from the menu: each player gets the kept grid of their slot, or the standard grid when none is kept. */
export function startOnKeptGrids(players: readonly CalibratedPlayer[], kept: KeptGrids, playerCount: PlayerCount): void {
  for (const player of players) {
    const grid = kept.get(player.index, playerCount);
    player.grid = grid ?? defaultGrid(player.index, playerCount);
    player.calibrated = grid !== undefined;
  }
}

/** The players in `calibrating`. A calibration changes only their grids. */
function calibratingOnly<T extends CalibratedPlayer>(players: readonly T[], calibrating: readonly PlayerIndex[]): T[] {
  return players.filter((player) => calibrating.includes(player.index));
}

/**
 * The calibration of the players in `calibrating` begins: their grids go back to the standard
 * grid, and grow from there. Each player's grid from before is put aside, for a calibration
 * that does not count. A calibration that stops another one, such as the C key during the
 * circles, keeps the grid from before the first.
 */
export function beginReach(
  players: readonly CalibratedPlayer[],
  calibrating: readonly PlayerIndex[],
  playerCount: PlayerCount,
): void {
  for (const player of calibratingOnly(players, calibrating)) {
    player.gridBeforeReach ??= { ...player.grid };
    player.reachSamples = [];
    player.grid = defaultGrid(player.index, playerCount);
  }
}

/**
 * Adds the hands of one tracking frame to the calibration of each player in `calibrating`, and
 * fits each of their grids to all their hands so far. The hands of other players do not count.
 */
export function addReach(
  players: readonly CalibratedPlayer[],
  calibrating: readonly PlayerIndex[],
  frame: TrackingFrame,
  playerCount: PlayerCount,
): void {
  for (const player of calibratingOnly(players, calibrating)) {
    for (const hand of frame.players[player.index].hands) {
      player.reachSamples.push({ x: hand.x, y: hand.y });
    }
    player.grid = fitGrid(player.reachSamples, player.index, playerCount);
  }
}

/**
 * The calibration of the players in `calibrating` ends. When a player's reach counts (see
 * `hasReachToFit`), the grid it gave is the player's grid, and it is kept for later rounds.
 * When it does not count, nothing changes: the player gets back the grid from before, and
 * `calibrated` and the kept grid stay as they were. Returns the players whose calibration did
 * not count.
 */
export function finishReach(
  players: readonly CalibratedPlayer[],
  calibrating: readonly PlayerIndex[],
  kept: KeptGrids,
  playerCount: PlayerCount,
): PlayerIndex[] {
  const unchanged: PlayerIndex[] = [];
  for (const player of calibratingOnly(players, calibrating)) {
    const gridBefore = player.gridBeforeReach ?? player.grid;
    player.gridBeforeReach = null;
    if (hasReachToFit(player.reachSamples)) {
      player.calibrated = true;
      kept.keep(player.index, playerCount, player.grid);
    } else {
      player.grid = gridBefore;
      unchanged.push(player.index);
    }
  }
  return unchanged;
}

/**
 * The note that tells the players that a calibration did not count. With two players it names
 * each player whose grid stayed. Null when every calibration counted.
 */
export function gridNotChangedText(unchanged: readonly PlayerIndex[], playerCount: PlayerCount): string | null {
  if (unchanged.length === 0) return null;
  if (playerCount === 1) return 'Grid not changed: draw bigger circles to calibrate';
  const names = unchanged.map((index) => `P${index + 1}`);
  if (names.length === 1) return `${names[0]} grid not changed: draw bigger circles to calibrate`;
  return `${names.join(' and ')} grids not changed: draw bigger circles to calibrate`;
}

/**
 * What the screen says while players draw their circles. With two players and a calibration
 * of one, it names that player, so the other one knows to wait.
 */
export function circlesMessage(calibrating: readonly PlayerIndex[], playerCount: PlayerCount): string {
  if (playerCount === 1 || calibrating.length !== 1) return 'Draw the biggest circles you can with both arms!';
  return `P${calibrating[0] + 1}: draw the biggest circles you can with both arms!`;
}
