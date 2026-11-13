import { CHART, LEVELS } from './config';
import type { LevelRules } from './config';
import { isBarStart, leadInEndSec, medianBeatInterval, tailStartSec } from './manifest';
import { moveForm, moveSteps, noMoves, phraseBeats, planPhrases } from './moves';
import type { MoveName, MoveStep, MoveTag, PhrasePlan } from './moves';
import type { GestureName } from '../tracking/types';
import type { Cue, Level, Manifest, SlideSpeed } from './types';

export interface ChartOptions {
  level: Level;
  /** Ask for a hand shape on some single-cell taps. */
  shapes: boolean;
  seed: number;
  /** Where play ends, in song seconds. The last bar before it has no cues. */
  endSec: number;
  /** The share of phrases in busy music that hold a move, 0 to 1. Unset or 0: no moves. See moves.ts. */
  moves?: number;
  /**
   * No move starts before this time, in song seconds. A round that starts inside the song
   * passes its start plus `CHART.leadSec`, where its first cue may come, so that the round
   * never begins with the rest of a move.
   */
  movesFromSec?: number;
}

const EPSILON = 1e-8;
const CENTRE = 4;
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
 * Cells a slide may end on: two steps from `from` along a row, column or diagonal,
 * so every slide crosses the grid. The centre has no such cell, so it reaches any other cell.
 */
export function slideTargets(from: number): number[] {
  const others = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((cell) => cell !== from);
  if (from === CENTRE) return others;
  return others.filter((cell) => {
    const rows = Math.abs(row(cell) - row(from));
    const columns = Math.abs(column(cell) - column(from));
    const onOneLine = rows === 0 || columns === 0 || rows === columns;
    return onOneLine && Math.max(rows, columns) === 2;
  });
}

/**
 * The cell a slow slide passes through: halfway between two cells that are two steps apart.
 * In a 3x3 grid numbered row by row, that cell's number is the mean of the two ends.
 */
export function middleCell(from: number, to: number): number {
  return (from + to) / 2;
}

/** Splits one roll by the level's speed shares. A slow slide needs a middle cell; without one it is normal. */
function pickSlideSpeed(shares: Record<SlideSpeed, number>, roll: number, slowPossible: boolean): SlideSpeed {
  if (roll < shares.fast) return 'fast';
  if (roll < shares.fast + shares.slow && slowPossible) return 'slow';
  return 'normal';
}

/**
 * How many cue intervals a slide takes up, counted from its start: no other cue starts in them.
 * A fast slide ends after half an interval, but the rest of that interval stays free. In a real
 * round, 6 of 8 taps that came 0.3 s after a fast slide were missed.
 */
const SLIDE_INTERVALS: Record<SlideSpeed, number> = { fast: 1, normal: 1, slow: 2 };

/**
 * The hand shape for every beat, for a level that asks for a shape on every cue.
 * One shape lasts a few seconds, from a bar start to a later bar start, and the next one is
 * always different. A new shape on every cue could not be read at this speed.
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

/**
 * The cues of a round that starts partway into the song. Players need a moment to find the
 * beat, so cues in the first seconds after the start are left out.
 */
export function cuesFrom<C extends { timeSec: number }>(cues: C[], startSec: number): C[] {
  if (startSec <= 0) return cues;
  return cues.filter((cue) => cue.timeSec >= startSec + CHART.leadSec);
}

/**
 * Why a cue is in a chart. Most cues sit on a cue beat. Two kinds come on top of those: an
 * off-beat tap, and a tap for the other hand during a slow slide. A move's cues sit on cue
 * beats too, but the move chooses them, not the rolls of the beat. The level rules' shares of
 * slides and doubles count the cues of role 'beat' only.
 */
export type CueRole = 'beat' | 'offbeat' | 'companion' | 'move';

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
 * hand last reached a target. A tap takes one hand per cell, and a slide keeps its hand until
 * the slide ends.
 */
class HandBudget {
  private readonly lastTargetSec = [-Infinity, -Infinity];

  /** How many hands have rested long enough to reach a new target at `timeSec`. */
  freeAt(timeSec: number): number {
    return this.lastTargetSec.filter((last) => timeSec - last >= CHART.handRestSec - EPSILON).length;
  }

  /** Gives a reach that ends at `untilSec` to the hand that has rested longest. */
  use(untilSec: number): void {
    const hand = this.lastTargetSec[0] <= this.lastTargetSec[1] ? 0 : 1;
    this.lastTargetSec[hand] = untilSec;
  }

  /** A slide is one hand's reach from its first cell to its last. A tap uses one hand per cell. */
  useFor(cue: Cue): void {
    if (cue.kind === 'slide') this.use(cue.times[cue.times.length - 1]);
    else cue.cells.forEach(() => this.use(cue.timeSec));
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
  // Every beat asks for its stride several times: work each one out once.
  const strides = beats.map((_, beat) => strideFor(beat));
  const strideAt = (beat: number): number => strides[beat] ?? strideFor(beat);
  const isCueBeat = (beat: number): boolean =>
    beat < beats.length &&
    beats[beat] >= firstCueSec &&
    beats[beat] < tailSec &&
    (beat - manifest.firstDownbeat) % strideAt(beat) === 0;

  const plans = planPhrases(manifest, seededRandom(options.seed ^ MOVE_SEED_STREAM), {
    share: options.moves ?? 0,
    fromSec: options.movesFromSec ?? -Infinity,
  });
  return {
    manifest,
    options,
    rules,
    master: masterCells(manifest, options.seed),
    phraseShape: rules.shapeOnEveryCue ? phraseShapes(manifest, options.seed) : undefined,
    strideAt,
    isCueBeat,
    plans,
    moveStarts: plans.filter((plan) => plan.move).map((plan) => plan.firstBeat),
  };
}

/** The moves roll on a stream of their own, so a chart without moves is the chart from before moves. */
const MOVE_SEED_STREAM = 0xd15c0;

/** What a chart keeps from one cue to the next. */
interface ChartState {
  entries: ChartEntry[];
  hands: HandBudget;
  /** The last beat the previous cue occupies, and when that cue ends. */
  previousEndBeat: number;
  previousEndSec: number;
  /** True when an off-beat tap followed the previous cue. */
  previousWasOffbeat: boolean;
  /** The move in progress. Null between moves. */
  move: RunningMove | null;
}

/** A move that has started: its steps, the next one to take, and the beat its phrase ends. */
interface RunningMove {
  tag: MoveTag;
  steps: MoveStep[];
  next: number;
  endBeat: number;
}

/** The rolls of one beat. */
type BeatRolls = ReturnType<typeof rollBeat>;

/**
 * The taps for the other hand roll on a stream of their own, `companionRandom`: newer rules
 * that roll on their own stream do not change older charts.
 */
function rollBeat(random: () => number, companionRandom: () => number) {
  return {
    kind: random(),
    slideSpeed: random(),
    slideTarget: random(),
    side: random(),
    partnerRow: random(),
    gesture: random(),
    shape: random(),
    offbeat: random(),
    offbeatCell: random(),
    companion: companionRandom(),
    companionCell: companionRandom(),
  };
}

/**
 * The cues of `generateChart`, each with its role. A cue's beat index cannot tell the role:
 * in a song with cues on every second beat, an off-beat tap sits on a whole beat.
 */
export function chartEntries(manifest: Manifest, options: ChartOptions): ChartEntry[] {
  const frame = chartFrame(manifest, options);
  const random = seededRandom(options.seed ^ 0xa519);
  const companionRandom = seededRandom(options.seed ^ 0xc0de);
  const state: ChartState = {
    entries: [],
    hands: new HandBudget(),
    previousEndBeat: -Infinity,
    previousEndSec: -Infinity,
    previousWasOffbeat: false,
    move: null,
  };

  for (let beat = 0; beat < manifest.beats.length; beat++) {
    // Every beat takes the same rolls, used or not. One beat's choices then never shift
    // another beat's, and all levels read the same sequence.
    const roll = rollBeat(random, companionRandom);
    // Skip beats that hold no cue, beats a slide still occupies, and a beat that would come
    // too soon after the previous cue where the music changes intensity.
    if (!frame.isCueBeat(beat) || beat - state.previousEndBeat < frame.strideAt(beat)) continue;
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
 * ends when its steps are done, when the next phrase starts, or when a step does not fit.
 * Normal cues then go on from that beat.
 */
function nextMoveStep(frame: ChartFrame, state: ChartState, beat: number): MoveCueing | null {
  const plan = phraseAt(frame, beat);
  if (plan?.firstBeat === beat) state.move = startMove(frame, plan);
  const move = state.move;
  if (!move) return null;

  const step = move.steps[move.next];
  if (!step || beat >= move.endBeat || !stepFits(frame, step, beat, move.endBeat)) {
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
  const form = moveForm(intervals, frame.rules.slideChance > 0, plan.formRoll);
  if (!form) return null;
  return {
    tag: { name: plan.move, phrase: plan.index },
    steps: moveSteps(plan.move, form, plan.layout),
    next: 0,
    endBeat: plan.endBeat,
  };
}

/**
 * A tap fits on any cue beat of its phrase. A slide also needs its end beat: the next cue
 * beat, inside the phrase.
 */
function stepFits(frame: ChartFrame, step: MoveStep, beat: number, phraseEndBeat: number): boolean {
  if (step.length === 1) return true;
  const slideEndBeat = beat + frame.strideAt(beat);
  return slideEndBeat < phraseEndBeat && frame.isCueBeat(slideEndBeat);
}

/**
 * Adds a move's cue. Inside a move there are no off-beat taps, no taps for the other hand and
 * no shapes from the shapes switch: the move is enough to follow. A level with a shape on
 * every cue keeps its phrase shape.
 */
function addMoveCue(frame: ChartFrame, state: ChartState, beat: number, move: MoveCueing): void {
  const cue = moveCue(frame, beat, move.step);
  if (frame.phraseShape) cue.gesture = frame.phraseShape[beat];
  addCue(frame, state, { cue, role: 'move', move: move.tag });
  state.previousWasOffbeat = false;
}

/** A tap, or a normal slide that ends on the next cue beat. */
function moveCue(frame: ChartFrame, beat: number, step: MoveStep): Cue {
  const { beats } = frame.manifest;
  const timeSec = beats[beat];
  if (step.length === 1) {
    return { kind: 'tap', timeSec, beatIndex: beat, cells: [...step], times: [timeSec] };
  }
  const endSec = beats[beat + frame.strideAt(beat)];
  return { kind: 'slide', speed: 'normal', timeSec, beatIndex: beat, cells: [...step], times: [timeSec, endSec] };
}

/**
 * True when a cue on `beat` that takes `intervals` cue intervals would leave no room for the
 * first cue of the next planned move. Normal cues keep that beat free at every level, so
 * players on different levels start the same move together.
 */
function crowdsMove(frame: ChartFrame, beat: number, intervals: number): boolean {
  const start = nextMoveStart(frame, beat);
  if (start === undefined) return false;
  const endBeat = beat + intervals * frame.strideAt(beat);
  return start - endBeat < frame.strideAt(start);
}

/** The first beat of the next phrase after `beat` whose plan holds a move. */
function nextMoveStart(frame: ChartFrame, beat: number): number | undefined {
  return frame.moveStarts.find((start) => start > beat);
}

/** The cue of a cue beat, then a tap for the other hand or an off-beat tap when one fits. */
function addBeatCues(frame: ChartFrame, state: ChartState, beat: number, roll: BeatRolls): void {
  const cue = beatCue(frame, state, beat, roll);
  if (frame.phraseShape) cue.gesture = frame.phraseShape[beat];
  addCue(frame, state, { cue, role: 'beat' });
  addCompanionTap(frame, state, cue, roll);
  addOffbeatTap(frame, state, cue, roll);
}

/** Adds the cue of a cue beat, and books the beats it occupies and the hands it takes. */
function addCue(frame: ChartFrame, state: ChartState, entry: ChartEntry): void {
  const { cue } = entry;
  state.entries.push(entry);
  const intervalsTaken = cue.kind === 'slide' && cue.speed ? SLIDE_INTERVALS[cue.speed] : 0;
  state.previousEndBeat = cue.beatIndex + intervalsTaken * frame.strideAt(cue.beatIndex);
  state.previousEndSec = cue.times[cue.times.length - 1];
  state.hands.useFor(cue);
}

/**
 * One roll picks the kind of cue: the first share is a slide, the next share a double, the
 * rest a single tap. Each share is then exactly the chance in the level rules.
 * Every slide needs a next cue beat: it sets how long the slide takes. And a slide never
 * starts straight after an off-beat tap: a slide takes a player's whole attention, so it
 * gets a clear moment before it and after it. Nor does a slide run into the first beat of a
 * planned move.
 */
function beatCue(frame: ChartFrame, state: ChartState, beat: number, roll: BeatRolls): Cue {
  const { manifest, rules } = frame;
  const busy = manifest.intensity[beat] >= CHART.busyIntensity;
  const hasNextCue = frame.isCueBeat(beat + frame.strideAt(beat));
  const freeHands = state.hands.freeAt(manifest.beats[beat]);
  const slideFits = hasNextCue && !state.previousWasOffbeat && !crowdsMove(frame, beat, SLIDE_INTERVALS.normal);
  const slideShare = busy && slideFits ? rules.slideChance : 0;
  const doubleAllowed =
    busy && freeHands === 2 && (!rules.doublesOnBarStartsOnly || isBarStart(manifest, beat));
  const doubleShare = doubleAllowed ? rules.doubleChance : 0;

  if (roll.kind < slideShare) return slideCue(frame, beat, roll);
  if (roll.kind < slideShare + doubleShare) return doubleCue(frame, beat, roll);
  return singleCue(frame, state, beat, roll);
}

/** A slide from the beat's master cell across the grid, at the speed one roll picks. */
function slideCue(frame: ChartFrame, beat: number, roll: BeatRolls): Cue {
  const { beats } = frame.manifest;
  const stride = frame.strideAt(beat);
  const timeSec = beats[beat];
  const nextCueSec = beats[beat + stride];
  const from = frame.master[beat];
  const targets = slideTargets(from);
  const to = targets[Math.floor(roll.slideTarget * targets.length)];
  const slowFits = frame.isCueBeat(beat + 2 * stride) && !crowdsMove(frame, beat, SLIDE_INTERVALS.slow);
  const slowPossible = from !== CENTRE && slowFits;
  const speed = pickSlideSpeed(frame.rules.slideSpeeds, roll.slideSpeed, slowPossible);

  if (speed === 'fast') {
    const times = [timeSec, (timeSec + nextCueSec) / 2];
    return { kind: 'slide', speed, timeSec, beatIndex: beat, cells: [from, to], times };
  }
  if (speed === 'slow') {
    const cells = [from, middleCell(from, to), to];
    const times = [timeSec, nextCueSec, beats[beat + 2 * stride]];
    return { kind: 'slide', speed, timeSec, beatIndex: beat, cells, times };
  }
  return { kind: 'slide', speed, timeSec, beatIndex: beat, cells: [from, to], times: [timeSec, nextCueSec] };
}

function doubleCue(frame: ChartFrame, beat: number, roll: BeatRolls): Cue {
  const timeSec = frame.manifest.beats[beat];
  const cells = doubleCells(frame.master[beat], roll.side, roll.partnerRow);
  return { kind: 'tap', timeSec, beatIndex: beat, cells, times: [timeSec, timeSec] };
}

/** A tap on the beat's master cell. With shapes on, some ask for a shape, when the hand has time to make it. */
function singleCue(frame: ChartFrame, state: ChartState, beat: number, roll: BeatRolls): Cue {
  const timeSec = frame.manifest.beats[beat];
  const cue: Cue = { kind: 'tap', timeSec, beatIndex: beat, cells: [frame.master[beat]], times: [timeSec] };
  const rested = timeSec - state.previousEndSec >= CHART.gestureGapSec - EPSILON;
  if (frame.options.shapes && rested && roll.gesture < CHART.gestureChance) {
    cue.gesture = CHART.gesturePool[Math.floor(roll.shape * CHART.gesturePool.length)];
  }
  return cue;
}

/**
 * A slow slide leaves the other hand free. That hand gets a tap on the slide's middle beat,
 * in a cell the slide does not pass through.
 */
function addCompanionTap(frame: ChartFrame, state: ChartState, slide: Cue, roll: BeatRolls): void {
  if (slide.speed !== 'slow' || roll.companion >= frame.rules.companionTapChance) return;
  const midSec = slide.times[1];
  if (state.hands.freeAt(midSec) === 0) return;

  const beat = slide.beatIndex;
  const cell = pickWeighted(CHART.cellWeights, roll.companionCell, (c) => !slide.cells.includes(c));
  const midBeat = beat + frame.strideAt(beat);
  const tap: Cue = { kind: 'tap', timeSec: midSec, beatIndex: midBeat, cells: [cell], times: [midSec] };
  if (frame.phraseShape) tap.gesture = frame.phraseShape[beat];
  state.entries.push({ cue: tap, role: 'companion' });
  state.hands.use(midSec);
}

/**
 * An off-beat tap: one extra cell halfway to the next cue beat. It follows taps only, it
 * needs a hand that is free by then, and it avoids the cells just used and the cell that is
 * likely to come next. It never comes just before a planned move, which may start with a slide.
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
  const offbeatFits = cue.kind === 'tap' && busy && hasNextCue && !beforeMove && state.hands.freeAt(offbeatSec) > 0;
  state.previousWasOffbeat = offbeatFits && roll.offbeat < rules.offbeatChance;
  if (!state.previousWasOffbeat) return;

  const taken = [...cue.cells, frame.master[nextCueBeat]];
  const cell = pickWeighted(CHART.cellWeights, roll.offbeatCell, (c) => !taken.includes(c));
  const tap: Cue = { kind: 'tap', timeSec: offbeatSec, beatIndex: beat + stride / 2, cells: [cell], times: [offbeatSec] };
  if (frame.phraseShape) tap.gesture = frame.phraseShape[beat];
  state.entries.push({ cue: tap, role: 'offbeat' });
  state.previousEndSec = offbeatSec;
  state.hands.use(offbeatSec);
}
