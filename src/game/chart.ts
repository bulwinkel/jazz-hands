import { CHART, LEVELS } from './config';
import type { LevelRules } from './config';
import { isBarStart, leadInEndSec, medianBeatInterval, tailStartSec } from './manifest';
import { moveForm, moveSteps, noMoves, phraseBeats, planPhrases } from './moves';
import type { MoveName, MoveStep, MoveTag, PhrasePlan } from './moves';
import {
  firstStep,
  nextPlace,
  placeBeforePhrase,
  planShuffles,
  rollPattern,
  shapeAtStep,
  shapeOfStep,
  shapePattern,
} from './shapePatterns';
import type { PatternPlace, PatternRolls, Shuffle } from './shapePatterns';
import type { GestureName } from '../tracking/types';
import type { Cue, Level, Manifest, SlideStep } from './types';

export interface ChartOptions {
  level: Level;
  /**
   * The hand shapes switch: ask for a hand shape on some single taps, and at a level with
   * `shapesOnDoublesAndSlides` on some taps for two hands and some slides too.
   */
  shapes: boolean;
  seed: number;
  /** Where play ends, in song seconds. The last bar before it has no cues. */
  endSec: number;
  /** The share of phrases in busy music that hold a move, 0 to 1. Unset or 0: no moves. See moves.ts. */
  moves?: number;
  /**
   * Where the round's first cue may come, in song seconds. A round that starts inside the song
   * passes its start plus `CHART.leadSec`: `cuesFrom` drops every cue before it. No move starts
   * before it, so that the round never begins with the rest of a move. The shuffle phrases of a
   * level with a shape on every cue count the phrases and the seconds of the round from it.
   * Unset: the round starts with the song.
   */
  roundFromSec?: number;
}

const EPSILON = 1e-8;
const row = (cell: number): number => Math.floor(cell / 3);
const column = (cell: number): number => cell % 3;

/** Mulberry32: a tiny seeded generator. One seed always gives the same sequence. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(weights: readonly number[], roll: number, allowed: (index: number) => boolean): number {
  const options = weights.map((weight, index) => ({ weight, index })).filter((o) => allowed(o.index));
  let remaining = roll * options.reduce((sum, o) => sum + o.weight, 0);
  for (const option of options) {
    remaining -= option.weight;
    if (remaining < 0) return option.index;
  }
  return options[options.length - 1].index;
}

/**
 * One cell for every beat of the song. Every level takes its cells from this sequence,
 * so two players on different levels reach for the same cell when both have a cue on a beat.
 */
export function masterCells(manifest: Manifest, seed: number): number[] {
  const random = seededRandom(seed);
  const cells: number[] = [];
  for (let beat = 0; beat < manifest.beats.length; beat++) {
    const recent = cells.slice(-CHART.recentCells);
    cells.push(pickWeighted(CHART.cellWeights, random(), (cell) => !recent.includes(cell)));
  }
  return cells;
}

/**
 * The smallest stride, in beats, that keeps cues at least `minimumSec` apart.
 * This also guards against a manifest whose tempo is double the tempo people feel.
 */
export function selectStride(beatIntervalSec: number, minimumSec: number): number {
  const fits = CHART.strides.find((stride) => beatIntervalSec * stride >= minimumSec - EPSILON);
  return fits ?? CHART.strides[CHART.strides.length - 1];
}

/**
 * Two cells for two hands: one in the left column and one in the right, so the arms never cross.
 * A master cell in the centre column moves to a side.
 */
export function doubleCells(masterCell: number, sideRoll: number, partnerRowRoll: number): [number, number] {
  const side = column(masterCell) === 1 ? (sideRoll < 0.5 ? 0 : 2) : column(masterCell);
  const partnerRow = Math.floor(partnerRowRoll * 3);
  return [row(masterCell) * 3 + side, partnerRow * 3 + (2 - side)];
}

/**
 * Cells a slide may end on: two steps from `from` along a row, column or diagonal, so every
 * slide crosses the grid. The centre has none: no line of three cells starts there.
 */
export function slideTargets(from: number): number[] {
  return [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((cell) => {
    const rows = Math.abs(row(cell) - row(from));
    const columns = Math.abs(column(cell) - column(from));
    const onOneLine = rows === 0 || columns === 0 || rows === columns;
    return onOneLine && Math.max(rows, columns) === 2;
  });
}

/**
 * The middle cell of a slide: halfway between two cells that are two steps apart on one line.
 * In a 3x3 grid numbered row by row, that cell's number is the mean of the two ends.
 */
export function middleCell(from: number, to: number): number {
  return (from + to) / 2;
}

/**
 * The hand shape for every beat of a steady phrase, at a level that asks for a shape on every
 * cue. One shape lasts at least `CHART.shapePhraseSec`, from a bar start to a later bar start,
 * and the next one is always different. A shuffle phrase changes the shape from cue to cue
 * instead, by a pattern: see shapePatterns.ts.
 */
export function phraseShapes(manifest: Manifest, seed: number): GestureName[] {
  const random = seededRandom(seed ^ 0x5a9e);
  const pool: readonly GestureName[] = CHART.gesturePool;
  const pickOther = (current?: GestureName): GestureName => {
    const others = pool.filter((shape) => shape !== current);
    return others[Math.floor(random() * others.length)];
  };

  let shape = pickOther();
  let phraseStartedSec = manifest.beats[0];
  return manifest.beats.map((timeSec, beat) => {
    const longEnough = timeSec - phraseStartedSec >= CHART.shapePhraseSec - EPSILON;
    if (isBarStart(manifest, beat) && longEnough) {
      shape = pickOther(shape);
      phraseStartedSec = timeSec;
    }
    return shape;
  });
}

/** A hand cue or a face cue, as `cuesFrom` reads it. A face cue is never part of a slide. */
interface TimedCue {
  timeSec: number;
  slideStep?: SlideStep;
}

/**
 * The cues of a round that starts partway into the song. Players need a moment to find the
 * beat, so cues in the first seconds after the start are left out. A slide stays or goes as a
 * whole, by its first cell: a round never starts with the rest of a slide.
 */
export function cuesFrom<C extends TimedCue>(cues: C[], startSec: number): C[] {
  if (startSec <= 0) return cues;
  const firstSec = startSec + CHART.leadSec;
  const kept: C[] = [];
  let slideKept = false;
  for (const cue of cues) {
    if (cue.slideStep === 1) slideKept = cue.timeSec >= firstSec;
    const laterSlideCell = cue.slideStep === 2 || cue.slideStep === 3;
    const keep = laterSlideCell ? slideKept : cue.timeSec >= firstSec;
    if (keep) kept.push(cue);
  }
  return kept;
}

/**
 * Why a cue is in a chart. Most cues sit on a cue beat, and the rolls of that beat chose them:
 * role 'beat'. The first cell of a slide is one of those. An off-beat tap comes on top of them.
 * The second and third cells of a slide sit on cue beats too, but the slide chose them, not
 * the rolls of their beats: role 'slide'. A move's cues sit on cue beats, and the move chose
 * them. The level rules' shares of slides and doubles count the cues of role 'beat' only.
 */
export type CueRole = 'beat' | 'offbeat' | 'slide' | 'move';

/** A cue of a chart, with its role. */
export interface ChartEntry {
  cue: Cue;
  role: CueRole;
  /** The move that a cue of role 'move' belongs to. */
  move?: MoveTag;
}

/** The cue list for one player. The same manifest and options always give the same list. */
export function generateChart(manifest: Manifest, options: ChartOptions): Cue[] {
  return chartEntries(manifest, options).map((entry) => entry.cue);
}

/**
 * The shuffle of every phrase of a chart with these options, by phrase index: null for a steady
 * phrase. Empty at a level without a shape on every cue. For tests and tools.
 */
export function shufflePlan(manifest: Manifest, options: ChartOptions): (Shuffle | null)[] {
  return chartFrame(manifest, options).shuffles;
}

/** The entries of the cues that `cuesFrom` keeps for a round that starts at `startSec`. */
export function entriesFrom(entries: readonly ChartEntry[], startSec: number): ChartEntry[] {
  const kept = new Set(cuesFrom(entries.map((entry) => entry.cue), startSec));
  return entries.filter((entry) => kept.has(entry.cue));
}

/** How many moves of each name a chart holds. A move counts once, however many cues it has. */
export function countMoves(entries: readonly ChartEntry[]): Record<MoveName, number> {
  const counts = noMoves();
  const phrases = new Set<number>();
  for (const { move } of entries) {
    if (!move || phrases.has(move.phrase)) continue;
    phrases.add(move.phrase);
    counts[move.name]++;
  }
  return counts;
}

/**
 * A player has two hands, and a hand needs time to travel. The chart keeps a budget: when each
 * hand last reached a target. A tap takes one hand for each of its cells.
 */
class HandBudget {
  private readonly lastTargetSec: number[];

  /** Both hands rested, or the same hands as another budget, to try taps on a copy. */
  constructor(lastTargetSec: readonly number[] = [-Infinity, -Infinity]) {
    this.lastTargetSec = [...lastTargetSec];
  }

  /** How many hands have rested long enough to reach a new target at `timeSec`. */
  freeAt(timeSec: number): number {
    return this.lastTargetSec.filter((last) => timeSec - last >= CHART.handRestSec - EPSILON).length;
  }

  /** Gives the target of a tap at `atSec` to the hand that has rested longest. */
  take(atSec: number): void {
    const hand = this.lastTargetSec[0] <= this.lastTargetSec[1] ? 0 : 1;
    this.lastTargetSec[hand] = atSec;
  }

  /** A tap takes one hand for each of its cells. */
  takeFor(cue: Cue): void {
    cue.cells.forEach(() => this.take(cue.timeSec));
  }

  /**
   * True when single taps at these times, in this order, each find a rested hand. The taps are
   * tried on a copy: this budget does not change.
   */
  fitsTaps(timesSec: readonly number[]): boolean {
    const trial = new HandBudget(this.lastTargetSec);
    for (const timeSec of timesSec) {
      if (trial.freeAt(timeSec) === 0) return false;
      trial.take(timeSec);
    }
    return true;
  }
}

/** What every beat of one chart is decided against: the song, the level rules and the options. */
interface ChartFrame {
  manifest: Manifest;
  options: ChartOptions;
  rules: LevelRules;
  /** The cell of every beat. See `masterCells`. */
  master: number[];
  /** The shape of every beat, at a level with a shape on every cue. */
  phraseShape?: GestureName[];
  /**
   * At a level with a shape on every cue, the shuffle of each phrase, by its index: null for a
   * steady phrase. Empty at other levels. See shapePatterns.ts.
   */
  shuffles: (Shuffle | null)[];
  /** Beats from one cue to the next around this beat: 1 where cues come on every beat. */
  strideAt: (beat: number) => number;
  isCueBeat: (beat: number) => boolean;
  /** What each phrase holds, the same at every level. No plan holds a move when moves are off. */
  plans: PhrasePlan[];
  /** The first beats of the phrases whose plan holds a move, in order. */
  moveStarts: number[];
}

function chartFrame(manifest: Manifest, options: ChartOptions): ChartFrame {
  const rules = LEVELS[options.level];
  const { beats, intensity } = manifest;
  const beatIntervalSec = medianBeatInterval(manifest);
  const firstCueSec = leadInEndSec(manifest);
  const tailSec = tailStartSec(manifest, options.endSec);

  const strideFor = (beat: number): number => {
    const fast = intensity[beat] >= rules.fastFromIntensity;
    const stride = selectStride(beatIntervalSec, fast ? CHART.fastIntervalSec : CHART.slowIntervalSec);
    return intensity[beat] < rules.sparseBelowIntensity ? stride * 2 : stride;
  };
  // Every beat asks for its stride more than once: work each one out once.
  const strides = beats.map((_, beat) => strideFor(beat));
  const strideAt = (beat: number): number => strides[beat] ?? strideFor(beat);
  const isCueBeat = (beat: number): boolean =>
    beat < beats.length &&
    beats[beat] >= firstCueSec &&
    beats[beat] < tailSec &&
    (beat - manifest.firstDownbeat) % strideAt(beat) === 0;

  const plans = planPhrases(manifest, seededRandom(options.seed ^ MOVE_SEED_STREAM), {
    share: options.moves ?? 0,
    fromSec: options.roundFromSec ?? -Infinity,
  });
  const round = {
    firstCueSec: Math.max(firstCueSec, options.roundFromSec ?? -Infinity),
    endSec: options.endSec,
  };
  const shortestGapSec = (firstBeat: number, endBeat: number): number =>
    shortestCueGapSec(manifest, isCueBeat, firstBeat, endBeat);
  const shuffleRandom = seededRandom(options.seed ^ SHUFFLE_SEED_STREAM);
  return {
    manifest,
    options,
    rules,
    master: masterCells(manifest, options.seed),
    phraseShape: rules.shapeOnEveryCue ? phraseShapes(manifest, options.seed) : undefined,
    shuffles: rules.shapeOnEveryCue ? planShuffles(manifest, round, shuffleRandom, shortestGapSec) : [],
    strideAt,
    isCueBeat,
    plans,
    moveStarts: plans.filter((plan) => plan.move).map((plan) => plan.firstBeat),
  };
}

/** The moves roll on a stream of their own, so a chart without moves is the chart from before moves. */
const MOVE_SEED_STREAM = 0xd15c0;

/** The patterns of shuffle phrases roll on a stream of their own, so they change no cell or time. */
const SHUFFLE_SEED_STREAM = 0x5b0ff1e;

/**
 * The shortest time between two cue beats that follow each other, over the beats from
 * `firstBeat` up to `endBeat`. It takes the real times of the beats: a song that gets faster
 * inside a phrase counts at its fastest. Infinity where fewer than two cue beats come.
 */
function shortestCueGapSec(
  manifest: Manifest,
  isCueBeat: (beat: number) => boolean,
  firstBeat: number,
  endBeat: number,
): number {
  let shortestSec = Infinity;
  let previousSec: number | null = null;
  for (let beat = firstBeat; beat < endBeat; beat++) {
    if (!isCueBeat(beat)) continue;
    const timeSec = manifest.beats[beat];
    if (previousSec !== null) shortestSec = Math.min(shortestSec, timeSec - previousSec);
    previousSec = timeSec;
  }
  return shortestSec;
}

/** What a chart keeps from one cue to the next. */
interface ChartState {
  entries: ChartEntry[];
  hands: HandBudget;
  /**
   * The beat of the previous cue on a cue beat, the end cell of a slide too. An off-beat tap
   * does not count. The next cue comes a stride later at the earliest.
   */
  previousBeat: number;
  /** When the previous cue is due, an off-beat tap too. */
  previousSec: number;
  /** True when an off-beat tap followed the previous cue. */
  previousWasOffbeat: boolean;
  /** The move in progress. Null between moves. */
  move: RunningMove | null;
  /** The shuffle phrase that the cues step through. Null before the first shuffle phrase. */
  shuffleRun: ShuffleRun | null;
}

/**
 * A shuffle phrase that has started: its index, the step its pattern starts on, the shape of the
 * cue before it, and where its cues are in the pattern. Each shuffle phrase starts a new run.
 */
interface ShuffleRun {
  phrase: number;
  first: number;
  shapeBefore: GestureName | undefined;
  place: PatternPlace;
}

/** A move that has started: its steps, the next one to take, and the beat its phrase ends. */
interface RunningMove {
  tag: MoveTag;
  steps: MoveStep[];
  next: number;
  endBeat: number;
}

/**
 * The rolls of one beat: the rolls of `rollBeat`, and the rolls of a pattern of hand shapes.
 * The pattern rolls on a stream of its own, so the cells and times of a chart stay as they
 * were before patterns.
 */
type BeatRolls = ReturnType<typeof rollBeat> & { pattern: PatternRolls };

/** The patterns of hand shapes roll on a stream of their own. See `BeatRolls`. */
const PATTERN_SEED_STREAM = 0x5a1f7;

/** Takes the rolls of one beat in a fixed order, so the same seed always gives the same chart. */
function rollBeat(random: () => number) {
  return {
    kind: random(),
    slideTarget: random(),
    side: random(),
    partnerRow: random(),
    gesture: random(),
    shape: random(),
    offbeat: random(),
    offbeatCell: random(),
  };
}

/**
 * The cues of `generateChart`, each with its role. A cue's beat index cannot tell the role:
 * in a song with cues on every second beat, an off-beat tap sits on a whole beat.
 */
export function chartEntries(manifest: Manifest, options: ChartOptions): ChartEntry[] {
  const frame = chartFrame(manifest, options);
  const random = seededRandom(options.seed ^ 0xa519);
  const patternRandom = seededRandom(options.seed ^ PATTERN_SEED_STREAM);
  const state: ChartState = {
    entries: [],
    hands: new HandBudget(),
    previousBeat: -Infinity,
    previousSec: -Infinity,
    previousWasOffbeat: false,
    move: null,
    shuffleRun: null,
  };

  for (let beat = 0; beat < manifest.beats.length; beat++) {
    // Every beat takes the same rolls, used or not. One beat's choices then never shift
    // another beat's, and all levels read the same sequence.
    const roll: BeatRolls = { ...rollBeat(random), pattern: rollPattern(patternRandom) };
    // Skip beats that hold no cue, the later beats of a slide, and a beat that would come too
    // soon after the previous cue where the music changes intensity.
    if (!frame.isCueBeat(beat) || beat - state.previousBeat < frame.strideAt(beat)) continue;
    // Both hands are still travelling: no cue fits on this beat.
    if (state.hands.freeAt(manifest.beats[beat]) === 0) continue;

    const move = nextMoveStep(frame, state, beat);
    if (move) addMoveCue(frame, state, beat, move);
    else addBeatCues(frame, state, beat, roll);
  }
  return state.entries;
}

/** A step of a move, and the move it belongs to. */
interface MoveCueing {
  tag: MoveTag;
  step: MoveStep;
}

/**
 * The step of a move that this cue beat takes, or null for a normal cue. A move starts on the
 * first beat of a phrase whose plan holds one, when this level has room for a form of it. It
 * ends when its steps are done or when the next phrase starts. Normal cues then go on from
 * that beat.
 */
function nextMoveStep(frame: ChartFrame, state: ChartState, beat: number): MoveCueing | null {
  const plan = phraseAt(frame, beat);
  if (plan?.firstBeat === beat) state.move = startMove(frame, plan);
  const move = state.move;
  if (!move) return null;

  const step = move.steps[move.next];
  if (step === undefined || beat >= move.endBeat) {
    state.move = null;
    return null;
  }
  move.next++;
  return { tag: move.tag, step };
}

/** The phrase that holds this beat. Beats before the first bar start belong to none. */
function phraseAt(frame: ChartFrame, beat: number): PhrasePlan | undefined {
  const { firstDownbeat } = frame.manifest;
  if (beat < firstDownbeat) return undefined;
  return frame.plans[Math.floor((beat - firstDownbeat) / phraseBeats(frame.manifest))];
}

/**
 * The planned move of a phrase, in the form this level has room for. The room is the phrase's
 * beats divided by the stride on its first beat.
 */
function startMove(frame: ChartFrame, plan: PhrasePlan): RunningMove | null {
  if (!plan.move) return null;
  const intervals = (plan.endBeat - plan.firstBeat) / frame.strideAt(plan.firstBeat);
  const form = moveForm(intervals);
  if (!form) return null;
  return {
    tag: { name: plan.move, phrase: plan.index },
    steps: moveSteps(plan.move, form, plan.layout),
    next: 0,
    endBeat: plan.endBeat,
  };
}

/**
 * Adds a move's cue. Inside a move there are no off-beat taps and no shapes from the shapes
 * switch: the move is enough to follow. A level with a shape on every cue gives each cue of the
 * move its shape: the phrase shape, or in a shuffle phrase the next step of the pattern.
 */
function addMoveCue(frame: ChartFrame, state: ChartState, beat: number, move: MoveCueing): void {
  const cue = tapOn(frame, beat, move.step);
  giveEveryCueShapes(frame, state, cue);
  addCue(state, { cue, role: 'move', move: move.tag });
  state.previousWasOffbeat = false;
}

/** A tap on one cell, due on a beat. */
function tapOn(frame: ChartFrame, beat: number, cell: number): Cue {
  const timeSec = frame.manifest.beats[beat];
  return { timeSec, beatIndex: beat, cells: [cell] };
}

/**
 * True when cues from `beat` to `endBeat` would leave no room for the first cue of the next
 * planned move. Normal cues keep that beat free at every level, so players on different
 * levels start the same move together.
 */
function crowdsMove(frame: ChartFrame, beat: number, endBeat: number): boolean {
  const start = nextMoveStart(frame, beat);
  if (start === undefined) return false;
  return start - endBeat < frame.strideAt(start);
}

/** The first beat of the next phrase after `beat` whose plan holds a move. */
function nextMoveStart(frame: ChartFrame, beat: number): number | undefined {
  return frame.moveStarts.find((start) => start > beat);
}

/** What one roll picks for a cue beat. */
type BeatChoice = 'slide' | 'double' | 'single';

/**
 * The cues of a cue beat: a slide, or a tap followed by an off-beat tap when one fits. A slide
 * takes this cue beat and the next two, and nothing else comes on them.
 */
function addBeatCues(frame: ChartFrame, state: ChartState, beat: number, roll: BeatRolls): void {
  const choice = pickBeatCue(frame, state, beat, roll);
  if (choice === 'slide') {
    addSlide(frame, state, beat, roll);
    return;
  }
  const cue = choice === 'double' ? doubleCue(frame, state, beat, roll) : singleCue(frame, state, beat, roll);
  giveEveryCueShapes(frame, state, cue);
  addCue(state, { cue, role: 'beat' });
  addOffbeatTap(frame, state, cue, roll);
}

/**
 * Gives a cue its shapes at a level with a shape on every cue. Other levels give none here.
 *
 * In a steady phrase, every cell takes the phrase shape of the beat. In a shuffle phrase, the
 * cue takes the shape of the pattern now, and the second cell of a tap for two hands takes the
 * next shape. Each cue on a cue beat moves the pattern on: see `nextPlace`. A shape from the
 * shapes switch gives way to these shapes.
 */
function giveEveryCueShapes(frame: ChartFrame, state: ChartState, cue: Cue): void {
  if (!frame.phraseShape) return;
  // A beat before the first bar start belongs to no phrase: -1 finds no shuffle.
  const phrase = phraseAt(frame, cue.beatIndex)?.index ?? -1;
  const shuffle = frame.shuffles[phrase] ?? null;
  if (shuffle === null) {
    const shape = frame.phraseShape[cue.beatIndex];
    cue.shapes = cue.cells.map(() => shape);
    return;
  }

  const before = state.entries.at(-1);
  const run = shuffleRunFor(state, phrase, shuffle, before?.cue);
  run.place = nextPlace(run.place, shuffle, before?.role === 'offbeat');
  const now = shapeOfStep(shuffle.pattern, run.first, run.place.step, run.shapeBefore);
  const next = shapeOfStep(shuffle.pattern, run.first, run.place.step + 1, run.shapeBefore);
  cue.shapes = cue.cells.length === 2 ? twoHandShapes(cue.cells, now, next, before) : [now];
  cue.shuffle = true;
}

/**
 * The shapes of a tap for two hands in a shuffle phrase: the shape of the pattern now, and its
 * next shape. Directly after an off-beat tap, the cell on the side of that tap takes the shape
 * that the tap asked for, when it is one of the two: the hand that just made it keeps it.
 */
function twoHandShapes(cells: number[], now: GestureName, next: GestureName, before?: ChartEntry): GestureName[] {
  if (before?.role !== 'offbeat') return [now, next];
  const side = cellInColumnOf(cells, before.cue.cells[0]);
  if (side === -1) return [now, next];
  const sideShape = before.cue.shapes?.[0] === next ? next : now;
  const otherShape = sideShape === now ? next : now;
  return side === 0 ? [sideShape, otherShape] : [otherShape, sideShape];
}

/**
 * The index of the cell of `cells` in the column of `cell`. One hand plays the cells of a side
 * column, so that cell is on the same hand's side. -1 when no cell is, as for a cell in the
 * centre column after a tap for two hands, whose cells are in the side columns.
 */
function cellInColumnOf(cells: readonly number[], cell: number): number {
  return cells.findIndex((other) => column(other) === column(cell));
}

/**
 * The run of the shuffle phrase that a cue belongs to. The first cue of a phrase starts a new
 * run: the pattern starts again in each shuffle phrase, from its first step, or from its second
 * step when the first shape is the shape of the cue before the phrase.
 */
function shuffleRunFor(state: ChartState, phrase: number, shuffle: Shuffle, before: Cue | undefined): ShuffleRun {
  if (state.shuffleRun?.phrase === phrase) return state.shuffleRun;
  const shapeBefore = before?.shapes?.[0];
  const run: ShuffleRun = {
    phrase,
    first: firstStep(shuffle.pattern, shapeBefore),
    shapeBefore,
    place: placeBeforePhrase(shuffle),
  };
  state.shuffleRun = run;
  return run;
}

/** Adds a cue, and books its beat and the hands it takes. */
function addCue(state: ChartState, entry: ChartEntry): void {
  const { cue } = entry;
  state.entries.push(entry);
  state.previousBeat = cue.beatIndex;
  state.previousSec = cue.timeSec;
  state.hands.takeFor(cue);
}

/**
 * One roll picks what a cue beat holds: the first share is a slide, the next share a double,
 * the rest a single tap. Each share is then exactly the chance in the level rules, on the
 * beats where that cue fits.
 */
function pickBeatCue(frame: ChartFrame, state: ChartState, beat: number, roll: BeatRolls): BeatChoice {
  const { manifest, rules } = frame;
  const busy = manifest.intensity[beat] >= CHART.busyIntensity;
  const freeHands = state.hands.freeAt(manifest.beats[beat]);
  const slideShare = busy && slideFits(frame, state, beat) ? rules.slideChance : 0;
  const doubleAllowed =
    busy && freeHands === 2 && (!rules.doublesOnBarStartsOnly || isBarStart(manifest, beat));
  const doubleShare = doubleAllowed ? rules.doubleChance : 0;

  if (roll.kind < slideShare) return 'slide';
  if (roll.kind < slideShare + doubleShare) return 'double';
  return 'single';
}

/**
 * A slide needs a line of three cells from the beat's cell, so none starts in the centre. It
 * needs three cue beats in a row, one for each cell, and a rested hand for each of its taps in
 * turn. It never starts straight after an off-beat tap: a slide takes a player's whole
 * attention, so it gets a clear moment before it. Nor does it run into the first beat of a
 * planned move.
 */
function slideFits(frame: ChartFrame, state: ChartState, beat: number): boolean {
  const cellBeats = slideBeats(frame, beat);
  const endBeat = cellBeats[cellBeats.length - 1];
  if (slideTargets(frame.master[beat]).length === 0) return false;
  if (!cellBeats.every((cellBeat) => frame.isCueBeat(cellBeat))) return false;
  const tapTimesSec = cellBeats.map((cellBeat) => frame.manifest.beats[cellBeat]);
  if (!state.hands.fitsTaps(tapTimesSec)) return false;
  return !state.previousWasOffbeat && !crowdsMove(frame, beat, endBeat);
}

/**
 * The shapes of a slide that the shapes switch gives shapes, as a pattern that its cells step
 * through. Where its cells are at least `CHART.patternStepSec` apart, the cells change shape: a
 * pair (A B A) or a triple (A B C). Where they are closer, one shape lasts all three cells: a
 * hand has no time to change shape between them.
 */
function slidePattern(frame: ChartFrame, beat: number, roll: BeatRolls): GestureName[] {
  const pattern = shapePattern(roll.pattern);
  const timesSec = slideBeats(frame, beat).map((cellBeat) => frame.manifest.beats[cellBeat]);
  const closestSec = Math.min(timesSec[1] - timesSec[0], timesSec[2] - timesSec[1]);
  if (closestSec >= CHART.patternStepSec - EPSILON) return pattern;
  return [pattern[0]];
}

/** The three cue beats of a slide that starts on `beat`: a stride apart, the stride of its first beat. */
function slideBeats(frame: ChartFrame, beat: number): number[] {
  const stride = frame.strideAt(beat);
  return [beat, beat + stride, beat + 2 * stride];
}

/** The place in a slide of each of its three cells, in order. */
const SLIDE_STEPS: readonly SlideStep[] = [1, 2, 3];

/**
 * Adds a slide: three taps in a line, from the beat's master cell through the middle cell to a
 * cell two steps away, one tap on each of its three cue beats. With the shapes switch, a level
 * with `shapesOnDoublesAndSlides` may give the slide shapes: see `slidePattern`. A level with a
 * shape on every cue gives each cell the shape of its own beat: the phrase shape, or in a
 * shuffle phrase the next step of the pattern. No off-beat tap follows any of the cells.
 */
function addSlide(frame: ChartFrame, state: ChartState, beat: number, roll: BeatRolls): void {
  const from = frame.master[beat];
  const targets = slideTargets(from);
  const to = targets[Math.floor(roll.slideTarget * targets.length)];
  const cells = [from, middleCell(from, to), to];
  // The rest before a shape counts from the cue before the slide, so decide before its cells.
  const startSec = frame.manifest.beats[beat];
  const pattern = switchShapesFit(frame, state, startSec, roll) ? slidePattern(frame, beat, roll) : null;

  slideBeats(frame, beat).forEach((cellBeat, k) => {
    const cue = tapOn(frame, cellBeat, cells[k]);
    cue.slideStep = SLIDE_STEPS[k];
    if (pattern) cue.shapes = [shapeAtStep(pattern, k)];
    giveEveryCueShapes(frame, state, cue);
    addCue(state, { cue, role: k === 0 ? 'beat' : 'slide' });
  });
  state.previousWasOffbeat = false;
}

/**
 * A tap for two hands at once, from the beat's master cell. With the shapes switch, a level with
 * `shapesOnDoublesAndSlides` may ask for two different shapes: the first two of a pattern.
 */
function doubleCue(frame: ChartFrame, state: ChartState, beat: number, roll: BeatRolls): Cue {
  const timeSec = frame.manifest.beats[beat];
  const cells = doubleCells(frame.master[beat], roll.side, roll.partnerRow);
  const cue: Cue = { timeSec, beatIndex: beat, cells };
  if (switchShapesFit(frame, state, timeSec, roll)) {
    const pattern = shapePattern(roll.pattern);
    cue.shapes = [shapeAtStep(pattern, 0), shapeAtStep(pattern, 1)];
  }
  return cue;
}

/**
 * True when the shapes switch gives a tap for two hands or a slide its shapes, at a level that
 * has them. The same roll and the same rest as for a single tap decide: see `switchGivesShape`.
 */
function switchShapesFit(frame: ChartFrame, state: ChartState, timeSec: number, roll: BeatRolls): boolean {
  return frame.rules.shapesOnDoublesAndSlides && switchGivesShape(frame, state, timeSec, roll);
}

/**
 * True when the shapes switch asks for a shape on a cue due at `timeSec`: on the share
 * `CHART.gestureChance` of the rolls, when the hand has time to make the shape after the
 * previous cue.
 */
function switchGivesShape(frame: ChartFrame, state: ChartState, timeSec: number, roll: BeatRolls): boolean {
  const rested = timeSec - state.previousSec >= CHART.gestureGapSec - EPSILON;
  return frame.options.shapes && rested && roll.gesture < CHART.gestureChance;
}

/** A tap on the beat's master cell. With shapes on, some ask for a shape, when the hand has time to make it. */
function singleCue(frame: ChartFrame, state: ChartState, beat: number, roll: BeatRolls): Cue {
  const cue = tapOn(frame, beat, frame.master[beat]);
  if (switchGivesShape(frame, state, cue.timeSec, roll)) {
    cue.shapes = [CHART.gesturePool[Math.floor(roll.shape * CHART.gesturePool.length)]];
  }
  return cue;
}

/**
 * An off-beat tap: one extra cell halfway to the next cue beat. It follows a tap of a cue beat,
 * never a slide. It needs a hand that is free by then, and it avoids the cells just used and
 * the cell that is likely to come next. It never comes just before a planned move, so that the
 * move starts after a clear moment.
 */
function addOffbeatTap(frame: ChartFrame, state: ChartState, cue: Cue, roll: BeatRolls): void {
  const { manifest, rules } = frame;
  const beat = cue.beatIndex;
  const stride = frame.strideAt(beat);
  const nextCueBeat = beat + stride;
  const hasNextCue = frame.isCueBeat(nextCueBeat);
  const busy = manifest.intensity[beat] >= CHART.busyIntensity;
  const offbeatSec = hasNextCue ? (cue.timeSec + manifest.beats[nextCueBeat]) / 2 : Infinity;
  const moveStart = nextMoveStart(frame, beat);
  const beforeMove = moveStart !== undefined && moveStart <= nextCueBeat;
  const offbeatFits = busy && hasNextCue && !beforeMove && state.hands.freeAt(offbeatSec) > 0;
  state.previousWasOffbeat = offbeatFits && roll.offbeat < rules.offbeatChance;
  if (!state.previousWasOffbeat) return;

  const taken = [...cue.cells, frame.master[nextCueBeat]];
  const cell = pickWeighted(CHART.cellWeights, roll.offbeatCell, (c) => !taken.includes(c));
  const tap: Cue = { timeSec: offbeatSec, beatIndex: beat + stride / 2, cells: [cell] };
  keepShape(frame, tap, cue);
  state.entries.push({ cue: tap, role: 'offbeat' });
  state.previousSec = offbeatSec;
  state.hands.take(offbeatSec);
}

/**
 * At a level with a shape on every cue, an off-beat tap keeps the shape of the cue before it.
 * It comes too soon after that cue for a new shape to read. After a tap for two hands with two
 * shapes, it takes the shape of the cell in its own column, on the side of the hand that plays
 * it. When no cell is in its column, it takes the shape of the first cell. In a shuffle phrase,
 * the pattern does not count it.
 */
function keepShape(frame: ChartFrame, tap: Cue, before: Cue): void {
  if (!frame.phraseShape || !before.shapes) return;
  const sameSide = cellInColumnOf(before.cells, tap.cells[0]);
  tap.shapes = [before.shapes[sameSide === -1 ? 0 : sameSide]];
  if (before.shuffle) tap.shuffle = true;
}
