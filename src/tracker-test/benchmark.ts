import { TRACKER_MODES } from '../tracking/config';
import type { GestureName, TrackerMode, TrackingFrame } from '../tracking/types';
import { summarizePhase } from './statistics';
import type { PlayerStatistics } from './statistics';

export const PHASES: readonly { instruction: string; emoji: string; expected: GestureName | null }[] = [
  { instruction: 'OPEN PALMS, hands up high', emoji: '🖐️', expected: 'open' },
  { instruction: 'FISTS, hands out wide', emoji: '✊', expected: 'fist' },
  { instruction: 'POINT UP, both hands', emoji: '☝️', expected: 'point' },
  { instruction: 'PEACE SIGNS, both hands', emoji: '✌️', expected: 'peace' },
  { instruction: 'WAVE both hands fast', emoji: '👋', expected: null },
];

export const BENCHMARK_TIMING = Object.freeze({ countdownMs: 8000, readyMs: 2000, recordMs: 5000 });
export type Stage = 'countdown' | 'ready' | 'recording' | 'done';
export interface PhaseResult {
  mode: TrackerMode;
  phase: number;
  instruction: string;
  expectedGesture: GestureName | null;
  durationMs: number;
  players: [PlayerStatistics, PlayerStatistics];
}

/** Wall-clock stages advance from actual transitions. Delays never skip a phase. */
export class BenchmarkSession {
  stage: Stage = 'countdown';
  modeIndex = 0;
  phaseIndex = 0;
  stageStartedMs: number;
  readonly results: PhaseResult[] = [];
  private frames: TrackingFrame[] = [];

  constructor(nowMs: number) { this.stageStartedMs = nowMs; }
  get mode(): TrackerMode { return TRACKER_MODES[this.modeIndex]; }
  get phase() { return PHASES[this.phaseIndex]; }
  get stageDurationMs(): number {
    return this.stage === 'countdown' ? BENCHMARK_TIMING.countdownMs
      : this.stage === 'ready' ? BENCHMARK_TIMING.readyMs : BENCHMARK_TIMING.recordMs;
  }

  secondsRemaining(nowMs: number): number {
    return Math.max(0, Math.ceil((this.stageDurationMs - (nowMs - this.stageStartedMs)) / 1000));
  }

  progress(nowMs: number): number {
    if (this.stage === 'done') return 1;
    const { countdownMs, readyMs, recordMs } = BENCHMARK_TIMING;
    const phaseMs = readyMs + recordMs;
    const elapsed = Math.min(this.stageDurationMs, Math.max(0, nowMs - this.stageStartedMs));
    const completed = this.stage === 'countdown' ? 0 : countdownMs
      + (this.modeIndex * PHASES.length + this.phaseIndex) * phaseMs
      + (this.stage === 'recording' ? readyMs : 0);
    return (completed + elapsed) / (countdownMs + TRACKER_MODES.length * PHASES.length * phaseMs);
  }

  /** Return true only when the stage changes. */
  advance(nowMs: number): boolean {
    if (this.stage === 'done' || nowMs - this.stageStartedMs < this.stageDurationMs) return false;
    if (this.stage === 'countdown') this.stage = 'ready';
    else if (this.stage === 'ready') this.stage = 'recording';
    else {
      // Frames must start in the five-second window. Do not include overrun or get-ready frames.
      const durationMs = BENCHMARK_TIMING.recordMs;
      this.results.push({ mode: this.mode, phase: this.phaseIndex + 1,
        instruction: this.phase.instruction, expectedGesture: this.phase.expected, durationMs,
        players: summarizePhase(this.frames, durationMs, this.mode, this.phase.expected) });
      this.frames = [];
      this.phaseIndex++;
      if (this.phaseIndex === PHASES.length) { this.phaseIndex = 0; this.modeIndex++; }
      if (this.modeIndex === TRACKER_MODES.length) {
        this.modeIndex = TRACKER_MODES.length - 1;
        this.phaseIndex = PHASES.length - 1;
        this.stage = 'done';
      } else this.stage = 'ready';
    }
    this.stageStartedMs = nowMs;
    return true;
  }

  record(frame: TrackingFrame, mode: TrackerMode): void {
    if (mode === this.mode && this.stage === 'recording' && frame.timeMs >= this.stageStartedMs
      && frame.timeMs < this.stageStartedMs + BENCHMARK_TIMING.recordMs) this.frames.push(frame);
  }
}
