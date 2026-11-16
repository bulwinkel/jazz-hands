/**
 * Cue sets give one song more than one chart. Each set gives the same chart on every run, so
 * "Play again" repeats it, and another set gives other cues for the same song. The sets also
 * differ by their share of moves (`CUE_SETS.moveShares`), so players can rate the sets and
 * learn which share they like.
 *
 * The set switch of the menu names a set, or 'random'. With 'random', each round that starts
 * from the menu plays a set picked at random, never the set that the song played last. The
 * players then meet every set without a trip to the switch, and two rounds of one song in a
 * row differ.
 *
 * A set must give other cues at the same difficulty. Every set tries a fixed list of candidate
 * seeds and keeps the one whose charts play most like the level usually does: closest to the
 * typical mix. The mix holds what makes a chart harder: its shares of slides and doubles, its
 * off-beat taps, and its number of cues. Two shares alone once left the sets of one song apart
 * by up to 16 off-beat taps at level 4.
 *
 * The choice measures the charts without moves. A move takes the place of cues on the same
 * cue beats, and the rest of the chart is what makes it easy or hard. The round then plays the
 * chosen seed with the set's share of moves.
 *
 * The typical mix is not the level rules. At levels 4 and 5 a slide never follows an
 * off-beat tap, and a double needs both hands free, so their charts stay well under the
 * chances in the rules. A choice aimed at the rules would pick the rare charts with the most
 * slides and doubles, which are harder than the level usually is. The typical mix is the
 * median over a pool of charts for the round: the candidates of all sets. One pool for all
 * sets makes every set aim at the same mix.
 */
import { chartEntries, entriesFrom } from './chart';
import type { ChartEntry } from './chart';
import { CHART, CUE_SETS, DEFAULT_SEED, LEVELS } from './config';
import { isBarStart } from './manifest';
import { clamp, median } from './numbers';
import type { Cue, Level, Manifest } from './types';

/** The first set. */
export const FIRST_CUE_SET = 1;

/** The number of sets: one for each share of moves in `CUE_SETS.moveShares`. */
export const CUE_SET_COUNT = CUE_SETS.moveShares.length;

/** The choice of the set switch that picks a set at random for each round. A new player starts with it. */
export const RANDOM_CUE_SET = 'random';

/** What the set switch holds: a set number, or 'random'. */
export type CueSetChoice = number | typeof RANDOM_CUE_SET;

export function isCueSet(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= FIRST_CUE_SET && value <= CUE_SET_COUNT;
}

export function isCueSetChoice(value: unknown): value is CueSetChoice {
  return value === RANDOM_CUE_SET || isCueSet(value);
}

/** The choice after this one on the set switch: random, then each set in turn, then random again. */
export function nextCueSetChoice(choice: CueSetChoice): CueSetChoice {
  if (choice === RANDOM_CUE_SET) return FIRST_CUE_SET;
  if (choice >= CUE_SET_COUNT) return RANDOM_CUE_SET;
  return choice + 1;
}

/**
 * Picks one of `count` sets, each with the same chance, but never `avoid`. With one set there
 * is no other to pick, so it gives that set. `roll` is a random number from 0 to 1.
 */
export function pickCueSet(count: number, avoid: number | null, roll: number): number {
  const sets = Array.from({ length: count }, (_, i) => FIRST_CUE_SET + i);
  const others = sets.filter((set) => set !== avoid);
  const options = others.length > 0 ? others : sets;
  const index = Math.floor(roll * options.length);
  // A roll of exactly 1 would point past the last option.
  return options[clamp(index, 0, options.length - 1)];
}

/**
 * Gives each round that starts from the menu its set. It keeps the last set of each song for
 * this visit to the page only: a new visit may start with any set. A round played again
 * without the menu keeps the cues of the round before it, and does not come here.
 */
export class CueSetPicker {
  private readonly lastSets = new Map<string, number>();
  private readonly random: () => number;

  /** `random` gives a number from 0 to 1. A test can give its own. */
  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  /** The set that a round of the song plays for the switch's choice. It becomes the song's last set. */
  setForRound(songId: string, choice: CueSetChoice): number {
    const set = choice === RANDOM_CUE_SET ? this.pick(songId) : choice;
    this.lastSets.set(songId, set);
    return set;
  }

  private pick(songId: string): number {
    const last = this.lastSets.get(songId) ?? null;
    return pickCueSet(CUE_SET_COUNT, last, this.random());
  }
}

/** The share of phrases in busy music that hold a move, for this set. */
export function cueSetMoveShare(set: number): number {
  return CUE_SETS.moveShares[set - FIRST_CUE_SET];
}

/** The seeds that a set tries, in order: DEFAULT_SEED + set × the spacing, and the numbers after it. */
export function candidateSeeds(set: number): number[] {
  const first = DEFAULT_SEED + set * CUE_SETS.candidateSpacing;
  return Array.from({ length: CUE_SETS.candidates }, (_, i) => first + i);
}

/** The seeds whose charts give the typical mix: the candidates of every set, in order. */
export function poolSeeds(): number[] {
  const sets = Array.from({ length: CUE_SET_COUNT }, (_, i) => FIRST_CUE_SET + i);
  return sets.flatMap(candidateSeeds);
}

/** What one player's chart is made for. */
export interface ChartFor {
  level: Level;
  shapes: boolean;
}

/** What a round's charts are made for: the song, the part of it that plays, and the players. */
export interface RoundCharts {
  manifest: Manifest;
  players: readonly ChartFor[];
  /** Where the round starts in the song. Cues that the round leaves out do not count. */
  startSec: number;
  endSec: number;
}

/**
 * What makes a chart easy or hard. The shares are of the cues that the level rules speak
 * about: the cues that a roll of a cue beat chose in busy music. Those are the single taps,
 * the doubles and the first cell of each slide.
 */
export interface ChartMix {
  /** The share that starts a slide. The second and third cells of a slide count in `cues` only. */
  slides: number;
  /** A level with doubles on bar starts only counts its bar starts. */
  doubles: number;
  /** Off-beat taps, per cue that the shares count. */
  offbeats: number;
  /** The number of cues of every kind. A slide is three cues. */
  cues: number;
}

const startsSlide = (cue: Cue): boolean => cue.slideStep === 1;
const isDouble = (cue: Cue): boolean => cue.cells.length === 2;

/** The share of `cues` that match. With no cues, 0. */
function shareOf(cues: readonly Cue[], matches: (cue: Cue) => boolean): number {
  return cues.length === 0 ? 0 : cues.filter(matches).length / cues.length;
}

/**
 * The mix of a chart. The level rules speak about cue beats in busy music, so the shares are
 * of the cues of role 'beat' on such beats: no off-beat taps, no later cells of a slide, and no
 * cues of a move. The number of cues counts every cue.
 */
export function chartMix(manifest: Manifest, entries: readonly ChartEntry[], level: Level): ChartMix {
  const busyBeatCues = entries
    .filter((entry) => entry.role === 'beat' && manifest.intensity[entry.cue.beatIndex] >= CHART.busyIntensity)
    .map((entry) => entry.cue);
  const doubleBeatCues = LEVELS[level].doublesOnBarStartsOnly
    ? busyBeatCues.filter((cue) => isBarStart(manifest, cue.beatIndex))
    : busyBeatCues;
  const offbeatCount = entries.filter((entry) => entry.role === 'offbeat').length;
  return {
    slides: shareOf(busyBeatCues, startsSlide),
    doubles: shareOf(doubleBeatCues, isDouble),
    offbeats: busyBeatCues.length === 0 ? 0 : offbeatCount / busyBeatCues.length,
    cues: entries.length,
  };
}

/** The typical mix of a pool of charts: the median of each part. */
export function typicalMix(mixes: readonly ChartMix[]): ChartMix {
  const middle = (part: keyof ChartMix): number => median(mixes.map((mix) => mix[part]));
  return {
    slides: middle('slides'),
    doubles: middle('doubles'),
    offbeats: middle('offbeats'),
    cues: middle('cues'),
  };
}

/**
 * How far a mix is from a target: the distance of each part, times its weight in
 * `CUE_SETS.weights`, added. A share is off by its points: 0.05 is 5 points. The number of
 * cues is off by its relative change: 5% more cues is like 5 points.
 */
export function mixDistance(mix: ChartMix, target: ChartMix): number {
  const { weights } = CUE_SETS;
  const cueChange = target.cues > 0 ? Math.abs(mix.cues / target.cues - 1) : 0;
  return (
    weights.slides * Math.abs(mix.slides - target.slides) +
    weights.doubles * Math.abs(mix.doubles - target.doubles) +
    weights.offbeats * Math.abs(mix.offbeats - target.offbeats) +
    weights.cues * cueChange
  );
}

/** The mix of the part of one player's chart that the round plays. The chart has no moves. */
export function playedMix(round: RoundCharts, player: ChartFor, seed: number): ChartMix {
  const entries = chartEntries(round.manifest, { ...player, seed, endSec: round.endSec });
  return chartMix(round.manifest, entriesFrom(entries, round.startSec), player.level);
}

/** What the choice of a round's seed works from. Each chart of the pool is made once. */
export interface PoolMeasure {
  seeds: number[];
  /** For each player, the mix of each seed of the pool, in the order of `seeds`. */
  mixes: ChartMix[][];
  /** For each player, the typical mix of the pool. */
  targets: ChartMix[];
}

export function measurePool(round: RoundCharts): PoolMeasure {
  const seeds = poolSeeds();
  const mixes = round.players.map((player) => seeds.map((seed) => playedMix(round, player, seed)));
  return { seeds, mixes, targets: mixes.map(typicalMix) };
}

/**
 * How far the round's charts from a seed of the pool are from the typical mix: the sum over
 * its players. Both players' charts share one seed, because they share the master cells.
 */
export function poolDistance(pool: PoolMeasure, seed: number): number {
  const index = pool.seeds.indexOf(seed);
  return pool.mixes.reduce((sum, mixes, player) => sum + mixDistance(mixes[index], pool.targets[player]), 0);
}

/**
 * The chart seed of a round with this cue set: its candidate closest to the typical mix. The
 * same round always gives the same seed.
 */
export function cueSetSeed(set: number, round: RoundCharts): number {
  return closestCandidate(set, measurePool(round));
}

/** The candidate of a set that is closest to the typical mix, the earlier one on a tie. */
export function closestCandidate(set: number, pool: PoolMeasure): number {
  let best = { seed: DEFAULT_SEED, distance: Infinity };
  for (const seed of candidateSeeds(set)) {
    const distance = poolDistance(pool, seed);
    if (distance < best.distance) best = { seed, distance };
  }
  return best.seed;
}
