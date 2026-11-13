/**
 * Cue sets give one song more than one chart. Each set gives the same chart on every run, so
 * "Play again" repeats it, and another set gives other cues for the same song.
 *
 * Set 1 is the chart from DEFAULT_SEED. Every other set tries a fixed list of candidate seeds
 * and keeps the seed whose charts come closest to the level rules. A random seed can be 15
 * points off the shares of slides and doubles that the rules ask for, and the level then
 * feels unlike its rules.
 */
import { chartEntries, cuesFrom } from './chart';
import type { ChartEntry } from './chart';
import { CHART, CUE_SETS, DEFAULT_SEED, LEVELS } from './config';
import { isBarStart } from './manifest';
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

const isSlide = (cue: Cue): boolean => cue.kind === 'slide';
const isDouble = (cue: Cue): boolean => cue.kind === 'tap' && cue.cells.length === 2;

/** How far the share of `cues` that match is from `chance`. With no cues there is nothing to miss. */
function offBy(cues: readonly Cue[], matches: (cue: Cue) => boolean, chance: number): number {
  if (cues.length === 0) return 0;
  return Math.abs(cues.filter(matches).length / cues.length - chance);
}

/**
 * How far a chart's mix is from the level rules: the distance of its share of slides from
 * `slideChance`, plus that of its share of doubles from `doubleChance`. 0.05 is 5 points off.
 *
 * The rules give the chances for cue beats in busy music, so only the cues on such beats
 * count. A level with doubles on bar starts only counts its doubles on bar starts. At levels
 * 4 and 5, a slide never follows an off-beat tap and a double needs both hands free. Those
 * limits keep their shares a little under the chances for every seed.
 */
export function ruleDistance(manifest: Manifest, entries: readonly ChartEntry[], level: Level): number {
  const rules = LEVELS[level];
  const busyBeatCues = entries
    .filter((entry) => entry.role === 'beat' && manifest.intensity[entry.cue.beatIndex] >= CHART.busyIntensity)
    .map((entry) => entry.cue);
  const doubleBeatCues = rules.doublesOnBarStartsOnly
    ? busyBeatCues.filter((cue) => isBarStart(manifest, cue.beatIndex))
    : busyBeatCues;
  return offBy(busyBeatCues, isSlide, rules.slideChance) + offBy(doubleBeatCues, isDouble, rules.doubleChance);
}

/** The entries of one player's chart that the round plays. */
function playedEntries(round: RoundCharts, player: ChartFor, seed: number): ChartEntry[] {
  const entries = chartEntries(round.manifest, { ...player, seed, endSec: round.endSec });
  const played = new Set(cuesFrom(entries.map((entry) => entry.cue), round.startSec));
  return entries.filter((entry) => played.has(entry.cue));
}

/**
 * How far a round's charts from `seed` are from the level rules: the sum over its players.
 * Both players' charts share one seed, because they share the master cells.
 */
export function roundDistance(round: RoundCharts, seed: number): number {
  return round.players.reduce(
    (sum, player) => sum + ruleDistance(round.manifest, playedEntries(round, player, seed), player.level),
    0,
  );
}

/**
 * The chart seed of a round with this cue set. Set 1 gives DEFAULT_SEED. Another set gives
 * its candidate with the smallest round distance, the earlier candidate on a tie. The same
 * round always gives the same seed.
 */
export function cueSetSeed(set: number, round: RoundCharts): number {
  if (set === FIRST_CUE_SET) return DEFAULT_SEED;
  let best = { seed: DEFAULT_SEED, distance: Infinity };
  for (const seed of candidateSeeds(set)) {
    const distance = roundDistance(round, seed);
    if (distance < best.distance) best = { seed, distance };
  }
  return best.seed;
}
