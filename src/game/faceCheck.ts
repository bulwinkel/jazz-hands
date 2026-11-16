import { FACES } from './config';
import type { PlayerRun } from './player';
import type { Phase, PlayerCount, PlayerIndex } from './types';

/**
 * The game does not punish a player for what the camera cannot see. Before play, the face
 * models look for the face of each player whose chart has face cues. When play begins, a
 * player whose face the tracker has not found in `FACES.sightingsToKeep` frames since the
 * ready screen or the results opened gets no face cues in this round.
 *
 * The face models cost tracking speed, and a phone or a tablet slows down as it gets warm. So
 * the check runs only shortly before play: while a player holds a Start cell, and during the
 * countdown. It stops for a player who has enough sightings.
 *
 * The Faces switch stays on. Each new round and each replay decides again, from the chart's
 * face cues. A restart inside a round has no ready screen, so it keeps the decision.
 */

/** What the face check reads and changes of a player. */
export type FaceCheckedPlayer = Pick<
  PlayerRun,
  'index' | 'chartFaceCues' | 'faceCues' | 'faceCuesDropped' | 'faceSightings'
>;

/** Where the round is, for the face check. */
export interface FaceCheckMoment {
  phase: Phase;
  /** True once the round has decided on its face cues. A restart keeps the decision of the round. */
  decided: boolean;
  /** True while a Start hold of any player is in progress. */
  startHeld: boolean;
}

/** The screens where a Start hold leads to play: the ready screen, and the results. */
const START_SCREENS: readonly Phase[] = ['ready', 'results'];

/**
 * True while the tracker must look for a player's face before play: while a Start hold is in
 * progress on the ready screen or the results, and during the countdown. Only for a player
 * whose chart has face cues, and only until they have enough sightings.
 */
export function looksForFaceBeforePlay(
  moment: FaceCheckMoment,
  player: Pick<FaceCheckedPlayer, 'chartFaceCues' | 'faceSightings'>,
): boolean {
  if (moment.decided) return false;
  const nearPlay = moment.phase === 'countdown' || (START_SCREENS.includes(moment.phase) && moment.startHeld);
  if (!nearPlay) return false;
  return player.chartFaceCues.length > 0 && player.faceSightings < FACES.sightingsToKeep;
}

/** The ready screen or the results opened: the tracker must find each face again, from now. */
export function restartFaceCheck(players: readonly FaceCheckedPlayer[]): void {
  for (const player of players) player.faceSightings = 0;
}

/**
 * Counts a frame in which the tracker found the player's face. Only a frame that the camera
 * took at `sinceMs` or later counts: a frame of an earlier screen or session can arrive late.
 * Both times are page times.
 */
export function countFaceSighting(
  player: Pick<FaceCheckedPlayer, 'faceSightings'>,
  frameTimeMs: number,
  sinceMs: number,
): void {
  if (frameTimeMs >= sinceMs) player.faceSightings++;
}

/**
 * Play begins: each player plays the face cues of their chart only when the tracker has found
 * their face in enough frames since the ready screen or the results opened. Returns the
 * players who lose their face cues. A player with faces off has none to lose.
 */
export function decideFaceCues(players: readonly FaceCheckedPlayer[]): PlayerIndex[] {
  const dropped: PlayerIndex[] = [];
  for (const player of players) {
    const hasFaceCues = player.chartFaceCues.length > 0;
    const seenEnough = player.faceSightings >= FACES.sightingsToKeep;
    player.faceCuesDropped = hasFaceCues && !seenEnough;
    player.faceCues = player.faceCuesDropped ? [] : player.chartFaceCues;
    if (player.faceCuesDropped) dropped.push(player.index);
  }
  return dropped;
}

/**
 * The note that tells the players that the round has no face cues for them. With two players
 * it names each player who lost them. Null when nobody lost them.
 */
export function facesOffText(dropped: readonly PlayerIndex[], playerCount: PlayerCount): string | null {
  if (dropped.length === 0) return null;
  if (playerCount === 1) return 'Faces off: the camera cannot see your face';
  const names = dropped.map((index) => `P${index + 1}`);
  if (names.length === 1) return `${names[0]} faces off: the camera cannot see your face`;
  return `${names.join(' and ')} faces off: the camera cannot see your faces`;
}
