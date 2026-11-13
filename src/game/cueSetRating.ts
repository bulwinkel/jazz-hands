/**
 * The players rate the cue set of a round on its results, with 1 to 5 stars, so that we learn
 * which sets they like at each level. Each choice saves one record at once: one line of
 * `test-results/cue-set-ratings.jsonl` on the dev server (see vite.config.ts). A player may
 * change a rating. The later record of the same round and player then replaces the earlier
 * one, in `scripts/ratings-summary.mjs`.
 *
 * A record holds what a rating may depend on: the song, the set and its share of moves, the
 * player's level and switches, what the played part of the chart held, and how the player did.
 */
import type { ChartMix } from './cueSet';
import type { MoveName } from './moves';
import { roundTo } from './numbers';
import type { PlayerRun } from './player';
import { accuracy } from './scoring';
import type { Level, PlayerCount, PlayerIndex, SongLength } from './types';

/** The dev-server route that keeps the ratings. */
export const RATINGS_PATH = '/__cue-set-ratings';

/** A rating: the number of stars a player chose. */
export type SetRating = 1 | 2 | 3 | 4 | 5;

/** Every rating, from the fewest stars up. */
export const SET_RATINGS: readonly SetRating[] = [1, 2, 3, 4, 5];

/** Shares keep this many decimals in a record: enough to compare charts, and short lines. */
const SHARE_DECIMALS = 4;

/** What the records of one round share: the same for both players and for a changed rating. */
export interface RatedRound {
  /** Tells this round apart from every other round. */
  id: string;
  /** The file name of the round's run report. Null until the dev server has saved the report. */
  runReport: string | null;
  songId: string;
  length: SongLength;
  playerCount: PlayerCount;
  /** A round with no cue set has nothing to rate, so a rated round always has one. */
  cueSet: number;
  seed: number;
  /** True when the game picked the set at random. */
  cueSetRandom: boolean;
  /** The share of phrases in busy music that hold a move. */
  moveShare: number;
}

/** What the game knows of a round when it ends, for its ratings. */
export interface EndedRound {
  endedAt: Date;
  songId: string;
  length: SongLength;
  playerCount: PlayerCount;
  /** Null for a round with no cue set: a seed from the URL. */
  cueSet: number | null;
  seed: number;
  cueSetRandom: boolean;
  moveShare: number;
}

/**
 * What the ratings of a round that just ended share, with a new round id. Null for a round
 * with no cue set: it has no set to rate, so its results show no rating row. `random` gives a
 * number from 0 to 1.
 */
export function ratedRoundOf(round: EndedRound, random: () => number): RatedRound | null {
  const { endedAt, cueSet, ...facts } = round;
  if (cueSet === null) return null;
  return { ...facts, cueSet, id: newRoundId(endedAt, random), runReport: null };
}

/** What a record needs of the player who rates. */
export type RatingPlayer = Pick<PlayerRun, 'index' | 'level' | 'shapes' | 'faces' | 'mix' | 'moves' | 'score'>;

/** One line of the ratings file. */
export interface RatingRecord {
  /** When the game saved the record, as an ISO time. */
  savedAt: string;
  roundId: string;
  runReport: string | null;
  song: string;
  length: SongLength;
  playerCount: PlayerCount;
  cueSet: number;
  seed: number;
  cueSetRandom: boolean;
  moveShare: number;
  /** 0 is the left player, or the only player. 1 is the right player. */
  player: PlayerIndex;
  level: Level;
  shapes: boolean;
  faces: boolean;
  /** What the part of the chart that the round played held. See `ChartMix` in cueSet.ts. */
  chart: ChartMix & { moves: Record<MoveName, number> };
  result: { score: number; accuracy: number; perfect: number; good: number; miss: number };
  rating: SetRating;
}

/**
 * A new round id: the time the round ended, then 6 random letters and digits, for example
 * `20261113-083015-k3j9x2`. The time sorts the ids, and the letters keep two rounds that end
 * in the same second apart. `random` gives a number from 0 to 1.
 */
export function newRoundId(endedAt: Date, random: () => number): string {
  const stamp = endedAt.toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
  const letters = Math.floor(random() * 36 ** 6)
    .toString(36)
    .padStart(6, '0');
  return `${stamp}-${letters}`;
}

/** The file name at the end of a path that the dev server gives, for example `run-20261113-083015.json`. */
export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
}

/** The record of one player's rating of the round. */
export function ratingRecord(
  round: RatedRound,
  player: RatingPlayer,
  rating: SetRating,
  savedAt: Date,
): RatingRecord {
  return {
    savedAt: savedAt.toISOString(),
    roundId: round.id,
    runReport: round.runReport,
    song: round.songId,
    length: round.length,
    playerCount: round.playerCount,
    cueSet: round.cueSet,
    seed: round.seed,
    cueSetRandom: round.cueSetRandom,
    moveShare: round.moveShare,
    player: player.index,
    level: player.level,
    shapes: player.shapes,
    faces: player.faces,
    chart: chartPart(player),
    result: resultPart(player.score),
    rating,
  };
}

function chartPart(player: RatingPlayer): RatingRecord['chart'] {
  const { mix } = player;
  return {
    slides: roundTo(mix.slides, SHARE_DECIMALS),
    doubles: roundTo(mix.doubles, SHARE_DECIMALS),
    fastSlides: roundTo(mix.fastSlides, SHARE_DECIMALS),
    offbeats: roundTo(mix.offbeats, SHARE_DECIMALS),
    cues: mix.cues,
    moves: { ...player.moves },
  };
}

function resultPart(score: RatingPlayer['score']): RatingRecord['result'] {
  return {
    score: Math.round(score.score),
    accuracy: roundTo(accuracy(score), SHARE_DECIMALS),
    perfect: score.perfect,
    good: score.good,
    miss: score.miss,
  };
}

/**
 * Posts a record to the dev server, which adds it to the ratings file. Answers whether the
 * server kept it. It never throws: a rating that is not saved only shows a note.
 */
export async function saveRating(record: RatingRecord): Promise<boolean> {
  try {
    const response = await fetch(RATINGS_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
    return response.ok;
  } catch {
    return false;
  }
}
