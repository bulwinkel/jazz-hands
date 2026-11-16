import type { PlayerRun } from './player';
import type { Phase, PlayerCount, PlayerIndex } from './types';

/**
 * The game does not punish a player for what the camera cannot see. Before play, the face
 * models look for the face of each player whose chart has face cues: on the ready screen, on
 * the results and during the countdown, until the camera has seen it. When play begins, a
 * player whose face the camera has not seen since that screen opened gets no face cues in
 * this round.
 *
 * The Faces switch stays on. Each new round and each replay decides again, from the chart's
 * face cues. A restart inside a round has no ready screen, so it keeps the decision.
 */

/** What the face check reads and changes of a player. */
export type FaceCheckedPlayer = Pick<
  PlayerRun,
  'index' | 'chartFaceCues' | 'faceCues' | 'faceCuesDropped' | 'faceSeenSinceScreen'
>;

/** The phases before play, in which the game looks for the faces. */
const BEFORE_PLAY: readonly Phase[] = ['ready', 'results', 'countdown'];

/**
 * True while the tracker must look for a player's face before play: in a phase before play,
 * for a player whose chart has face cues, until the camera has seen the face. One sighting
 * decides, so the face models then rest and hand tracking keeps its full speed. `decided` is
 * true after a restart, which keeps the decision of the round.
 */
export function looksForFaceBeforePlay(
  phase: Phase,
  player: Pick<FaceCheckedPlayer, 'chartFaceCues' | 'faceSeenSinceScreen'>,
  decided: boolean,
): boolean {
  if (!BEFORE_PLAY.includes(phase) || decided) return false;
  return player.chartFaceCues.length > 0 && !player.faceSeenSinceScreen;
}

/** The ready screen or the results opened: the camera must see each face again, from now. */
export function restartFaceCheck(players: readonly FaceCheckedPlayer[]): void {
  for (const player of players) player.faceSeenSinceScreen = false;
}

/**
 * Play begins: each player plays the face cues of their chart only when the camera has seen
 * their face since the ready screen or the results opened. Returns the players who lose their
 * face cues. A player with faces off has none to lose.
 */
export function decideFaceCues(players: readonly FaceCheckedPlayer[]): PlayerIndex[] {
  const dropped: PlayerIndex[] = [];
  for (const player of players) {
    const hasFaceCues = player.chartFaceCues.length > 0;
    player.faceCuesDropped = hasFaceCues && !player.faceSeenSinceScreen;
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
