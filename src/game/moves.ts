/**
 * Disco moves. A move is a named pattern of cues that takes the place of the random cues for
 * part of a phrase: "bottom left to top right and back, and the same for the other side", or a
 * circle through the outer cells. A player sees one move to dance, not a row of single cues.
 *
 * To add a move, add its name to `MoveName` and an entry to `MOVE_DEFINITIONS`: a function that
 * gives the cells of each form. The tests check that each form takes its number of intervals.
 *
 * Which phrases hold a move is planned once for the song, the same for every level, on a random
 * stream of its own. chart.ts then fits each planned move to the pace of a level.
 */
import { CHART, MOVES } from './config';
import type { Manifest } from './types';

export type MoveName = 'point' | 'circle';

/** The ways to play a move. Each step is a tap and takes one cue interval: `taps` takes 8, `shortTaps` 4. */
export type MoveForm = 'taps' | 'shortTaps';

/** The cue intervals of each form. A level gets the longest form that its phrase has room for. */
export const FORM_INTERVALS: Readonly<Record<MoveForm, number>> = { taps: 8, shortTaps: 4 };

/** One cue of a move: the cell of one tap. */
export type MoveStep = number;

/** The rolls that lay a move out on the grid, each from 0 to 1. */
export interface LayoutRolls {
  /** Where the move starts: the first diagonal of a point, the first corner of a circle. */
  origin: number;
  /** Which way a circle turns. */
  direction: number;
}

interface MoveDefinition {
  name: MoveName;
  /** The steps of each form, laid out by the rolls of the phrase. */
  forms: (rolls: LayoutRolls) => Record<MoveForm, MoveStep[]>;
}

/**
 * The two diagonals of the grid, each from its bottom cell to its top cell: bottom-left to
 * top-right, and bottom-right to top-left. Cell 0 is top-left on screen.
 */
const DIAGONALS = [
  [6, 2],
  [8, 0],
] as const;

/** Point: up one diagonal and back, twice, then the same on the other diagonal. */
function pointForms(rolls: LayoutRolls): Record<MoveForm, MoveStep[]> {
  const first = Math.floor(rolls.origin * DIAGONALS.length);
  const [a1, a2] = DIAGONALS[first];
  const [b1, b2] = DIAGONALS[1 - first];
  return {
    taps: [a1, a2, a1, a2, b1, b2, b1, b2],
    shortTaps: [a1, a2, b1, b2],
  };
}

/** The outer cells, clockwise on screen from the top-left corner. Every second cell is a corner. */
const RING = [0, 1, 2, 5, 8, 7, 6, 3];
const CORNERS = [0, 2, 8, 6];

/** Circle: every outer cell in ring order from a corner, or the corners alone, in either direction. */
function circleForms(rolls: LayoutRolls): Record<MoveForm, MoveStep[]> {
  const corner = CORNERS[Math.floor(rolls.origin * CORNERS.length)];
  const turned = rolls.direction < 0.5 ? RING : [...RING].reverse();
  const start = turned.indexOf(corner);
  const ring = [...turned.slice(start), ...turned.slice(0, start)];
  const corners = ring.filter((_, i) => i % 2 === 0);
  return { taps: ring, shortTaps: corners };
}

export const MOVE_DEFINITIONS: readonly MoveDefinition[] = [
  { name: 'point', forms: pointForms },
  { name: 'circle', forms: circleForms },
];

export const MOVE_NAMES: readonly MoveName[] = MOVE_DEFINITIONS.map((move) => move.name);

/** The steps of one form of a move, laid out by the rolls of its phrase. */
export function moveSteps(name: MoveName, form: MoveForm, rolls: LayoutRolls): MoveStep[] {
  const definition = MOVE_DEFINITIONS.find((move) => move.name === name);
  if (!definition) throw new Error(`No move is named ${name}.`);
  return definition.forms(rolls)[form];
}

/**
 * The form that a level gets in a phrase with room for `intervals` cue intervals: the taps
 * where 8 fit, the short taps where 4 fit, and none where fewer fit.
 */
export function moveForm(intervals: number): MoveForm | null {
  if (intervals >= FORM_INTERVALS.taps) return 'taps';
  if (intervals >= FORM_INTERVALS.shortTaps) return 'shortTaps';
  return null;
}

/** Which move a chart entry belongs to: the move's name and the phrase it plays in. */
export interface MoveTag {
  name: MoveName;
  /** The phrase, counted from 0 at the first bar start. One phrase holds at most one move. */
  phrase: number;
}

/** A count of 0 for every move. */
export function noMoves(): Record<MoveName, number> {
  const counts = {} as Record<MoveName, number>;
  for (const name of MOVE_NAMES) counts[name] = 0;
  return counts;
}

/**
 * What one phrase holds, the same at every level: the move, and the rolls that lay it out. A
 * level then fits the move to its own pace, or leaves it out.
 */
export interface PhrasePlan {
  /** Counted from 0 at the first bar start. */
  index: number;
  firstBeat: number;
  /** The first beat of the next phrase. */
  endBeat: number;
  /** Null when the phrase holds no move. */
  move: MoveName | null;
  layout: LayoutRolls;
}

/** When phrases hold moves. */
export interface MovePlanOptions {
  /** The share of phrases in busy music that hold a move, 0 to 1. */
  share: number;
  /** No move starts before this time, in song seconds. */
  fromSec: number;
}

/** The beats of one phrase: `MOVES.phraseBars` bars. */
export function phraseBeats(manifest: Manifest): number {
  return MOVES.phraseBars * manifest.beatsPerBar;
}

/**
 * The plan of every phrase of the song. Every phrase takes the same four rolls, used or not,
 * so one phrase's choices never shift another phrase's. Nothing here depends on the level:
 * players on different levels get the same move, laid out the same way, in the same phrase.
 */
export function planPhrases(manifest: Manifest, random: () => number, options: MovePlanOptions): PhrasePlan[] {
  const beatsPerPhrase = phraseBeats(manifest);
  const plans: PhrasePlan[] = [];
  let previousRolledMove: MoveName | null = null;

  for (let firstBeat = manifest.firstDownbeat; firstBeat < manifest.beats.length; firstBeat += beatsPerPhrase) {
    const roll = { start: random(), move: random(), origin: random(), direction: random() };
    // The rolls alone choose the move, so all levels agree even where a level leaves a move out.
    const rolledMove: MoveName | null = roll.start < options.share ? pickMove(roll.move, previousRolledMove) : null;
    previousRolledMove = rolledMove;
    plans.push({
      index: plans.length,
      firstBeat,
      endBeat: firstBeat + beatsPerPhrase,
      move: moveMayStart(manifest, firstBeat, options.fromSec) ? rolledMove : null,
      layout: { origin: roll.origin, direction: roll.direction },
    });
  }
  return plans;
}

/** The move of a roll. It is never the move that the previous phrase's rolls gave. */
function pickMove(roll: number, previous: MoveName | null): MoveName {
  const options = MOVE_NAMES.filter((name) => name !== previous);
  return options[Math.floor(roll * options.length)];
}

/** A move starts only where the music is busy, and not before `fromSec`. */
function moveMayStart(manifest: Manifest, beat: number, fromSec: number): boolean {
  const busy = manifest.intensity[beat] >= CHART.busyIntensity;
  return busy && manifest.beats[beat] >= fromSec;
}
