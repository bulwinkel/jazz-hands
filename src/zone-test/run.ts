import type { ZoneFrame } from '../tracking/zones';
import { PHASES, VARIANTS } from './config';
import type { Timing } from './config';
import { summarisePhase } from './statistics';
import type { PhaseSummary } from './statistics';

export type StepKind = 'countdown' | 'ready' | 'record';

/** One stretch of a run. `variant` and `phase` are indices into VARIANTS and PHASES. */
export interface Step {
  kind: StepKind;
  variant: number;
  phase: number;
  durationMs: number;
}

/** Every step of a run in order: the countdown, then get ready and record for each phase of each variant. */
export function runSteps(timing: Timing): Step[] {
  const steps: Step[] = [{ kind: 'countdown', variant: 0, phase: 0, durationMs: timing.countdownMs }];
  VARIANTS.forEach((_variant, variant) => {
    PHASES.forEach((_phase, phase) => {
      steps.push({ kind: 'ready', variant, phase, durationMs: timing.readyMs });
      steps.push({ kind: 'record', variant, phase, durationMs: timing.recordMs });
    });
  });
  return steps;
}

/**
 * One run of the test, from the countdown to the last recording.
 *
 * A step ends when its time is up, counted from the moment the step began. A late call, for
 * example after the slow first frame of a model, moves the rest of the run back. It never
 * shortens or skips a step.
 */
export class TestRun {
  /** The phase summaries so far, by variant and then by phase. */
  readonly summaries: PhaseSummary[][] = VARIANTS.map(() => []);

  private readonly zones: number;
  private readonly steps: Step[];
  private stepIndex = 0;
  private stepStartedMs: number;
  /** The frames of the recording that is running. */
  private recorded: ZoneFrame[] = [];

  constructor(zones: number, timing: Timing, nowMs: number) {
    this.zones = zones;
    this.steps = runSteps(timing);
    this.stepStartedMs = nowMs;
  }

  /** The step the run is in. Null when the run is done. */
  get step(): Step | null {
    return this.steps[this.stepIndex] ?? null;
  }

  /** The step that comes next, so the screen can say what to prepare for. */
  get upcoming(): Step | null {
    return this.steps[this.stepIndex + 1] ?? null;
  }

  /** Moves to the next step when the time of this one is up. True when the step changed. */
  advance(nowMs: number): boolean {
    const step = this.step;
    if (!step || nowMs - this.stepStartedMs < step.durationMs) return false;

    if (step.kind === 'record') this.summarise(step);
    this.stepIndex++;
    this.stepStartedMs = nowMs;
    return true;
  }

  /** Keeps a tracking frame when it was taken inside a recording. */
  record(frame: ZoneFrame): void {
    const step = this.step;
    if (step?.kind !== 'record') return;
    const sinceStartMs = frame.timeMs - this.stepStartedMs;
    if (sinceStartMs >= 0 && sinceStartMs < step.durationMs) this.recorded.push(frame);
  }

  /** Whole seconds left in the step, counted down for the screen. */
  secondsLeft(nowMs: number): number {
    const step = this.step;
    if (!step) return 0;
    const leftMs = step.durationMs - (nowMs - this.stepStartedMs);
    return Math.max(0, Math.ceil(leftMs / 1000));
  }

  /** How far the run has come, 0..1, by the planned length of its steps. */
  progress(nowMs: number): number {
    const step = this.step;
    if (!step) return 1;
    const plannedMs = (steps: readonly Step[]): number => steps.reduce((sum, each) => sum + each.durationMs, 0);
    const inStepMs = Math.max(0, Math.min(step.durationMs, nowMs - this.stepStartedMs));
    return (plannedMs(this.steps.slice(0, this.stepIndex)) + inStepMs) / plannedMs(this.steps);
  }

  private summarise(step: Step): void {
    const { expectedShape } = PHASES[step.phase];
    this.summaries[step.variant][step.phase] = summarisePhase(this.recorded, this.zones, step.durationMs, expectedShape);
    this.recorded = [];
  }
}
