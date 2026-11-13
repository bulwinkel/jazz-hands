/**
 * Cue sets give one song more than one chart. Each set gives the same chart on every run, so
 * "Play again" repeats it, and another set gives other cues for the same song.
 *
 * A set must give other cues at the same difficulty. Set 1 is the chart from DEFAULT_SEED.
 * Every other set tries a fixed list of candidate seeds and keeps the one whose charts play
 * most like the level usually does: closest to the typical mix. The mix holds what makes a
 * chart harder: its shares of slides, doubles and fast slides, its off-beat taps, and its
 * number of cues. Two shares alone left the sets of one song apart by up to 9 fast slides and
 * 16 off-beat taps at level 4.
 *
 * The typical mix is not the level rules. At levels 4 and 5 a slide never follows an
 * off-beat tap, and a double needs both hands free, so their charts stay well under the
 * chances in the rules. A choice aimed at the rules would pick the rare charts with the most
 * slides and doubles, which are harder than the level usually is. The typical mix is the
 * median over a pool of charts for the round: the candidates of all sets from 2 on. One pool
 * for all sets makes every set aim at the same mix.
 */
import { chartEntries, cuesFrom } from './chart';
import type { ChartEntry } from './chart';
import { CHART, CUE_SETS, DEFAULT_SEED, LEVELS } from './config';
import { isBarStart } from './manifest';
import { median } from './numbers';
import type { Cue, Level, Manifest } from './types';

/** The set with today's chart. A new player starts with it. */
export const FIRST_CUE_SET = 1;

export function isCueSet(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= FIRST_CUE_SET && value <= CUE_SETS.count;
}

/** The set after this one. After the last comes the first. */
export function nextCueSet(set: number): number {
  return (set % CUE_SETS.count) + 1;
}

/**
 * The seeds that a set from 2 on tries, in order: DEFAULT_SEED + set × the spacing, and the
 * numbers after it. Set 1 tries none: it is DEFAULT_SEED.
 */
export function candidateSeeds(set: number): number[] {
  const first = DEFAULT_SEED + set * CUE_SETS.candidateSpacing;
  return Array.from({ length: CUE_SETS.candidates }, (_, i) => first + i);
}

/** The seeds whose charts give the typical mix: the candidates of every set from 2 on, in order. */
export function poolSeeds(): number[] {
  const laterSets = Array.from({ length: CUE_SETS.count - FIRST_CUE_SET }, (_, i) => FIRST_CUE_SET + 1 + i);
  return laterSets.flatMap(candidateSeeds);
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
 * about: the cues on cue beats in busy music.
 */
export interface ChartMix {
  slides: number;
  /** A level with doubles on bar starts only counts its bar starts. */
  doubles: number;
  /** The hardest cue of levels 4 and 5. */
  fastSlides: number;
  /** Off-beat taps, per cue that the shares count. */
  offbeats: number;
  /** The number of cues of every kind. */
  cues: number;
}

const isSlide = (cue: Cue): boolean => cue.kind === 'slide';
const isFastSlide = (cue: Cue): boolean => cue.speed === 'fast';
const isDouble = (cue: Cue): boolean => cue.kind === 'tap' && cue.cells.length === 2;

/** The share of `cues` that match. With no cues, 0. */
function shareOf(cues: readonly Cue[], matches: (cue: Cue) => boolean): number {
  return cues.length === 0 ? 0 : cues.filter(matches).length / cues.length;
}

/**
 * The mix of a chart. The level rules speak about cue beats in busy music, so the shares are
 * of the cues of role 'beat' on such beats: no off-beat taps, no taps for the other hand
 * during a slow slide, and no cues of a move. The number of cues counts every cue.
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
    slides: shareOf(busyBeatCues, isSlide),
    doubles: shareOf(doubleBeatCues, isDouble),
    fastSlides: shareOf(busyBeatCues, isFastSlide),
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
    fastSlides: middle('fastSlides'),
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
    weights.fastSlides * Math.abs(mix.fastSlides - target.fastSlides) +
    weights.offbeats * Math.abs(mix.offbeats - target.offbeats) +
    weights.cues * cueChange
  );
}

/** The mix of the part of one player's chart that the round plays. */
export function playedMix(round: RoundCharts, player: ChartFor, seed: number): ChartMix {
  const entries = chartEntries(round.manifest, { ...player, seed, endSec: round.endSec });
  const played = new Set(cuesFrom(entries.map((entry) => entry.cue), round.startSec));
  return chartMix(round.manifest, entries.filter((entry) => played.has(entry.cue)), player.level);
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
 * The chart seed of a round with this cue set. Set 1 gives DEFAULT_SEED. Another set gives
 * its candidate closest to the typical mix. The same round always gives the same seed.
 */
export function cueSetSeed(set: number, round: RoundCharts): number {
  if (set === FIRST_CUE_SET) return DEFAULT_SEED;
  return closestCandidate(set, measurePool(round));
}

/** The candidate of a set from 2 on that is closest to the typical mix, the earlier one on a tie. */
export function closestCandidate(set: number, pool: PoolMeasure): number {
  let best = { seed: DEFAULT_SEED, distance: Infinity };
  for (const seed of candidateSeeds(set)) {
    const distance = poolDistance(pool, seed);
    if (distance < best.distance) best = { seed, distance };
  }
  return best.seed;
}
