import { describe, expect, it } from 'vitest';
import type { ZoneFrame } from '../tracking/zones';
import { PHASES, VARIANTS } from './config';
import type { Timing } from './config';
import { runSteps, TestRun } from './run';

const TIMING: Timing = { countdownMs: 10_000, readyMs: 2_000, recordMs: 5_000 };
const ZONES = 3;

function frame(timeMs: number): ZoneFrame {
  return { timeMs, inferenceMs: 20, zones: [[], [], []] };
}

/** A run that has just entered the recording of the first phase, at 12 s. */
function runInFirstRecording(): TestRun {
  const run = new TestRun(ZONES, TIMING, 0);
  run.advance(10_000);
  run.advance(12_000);
  return run;
}

describe('the steps of a run', () => {
  const steps = runSteps(TIMING);

  it('start with the countdown', () => {
    expect(steps[0]).toEqual({ kind: 'countdown', variant: 0, phase: 0, durationMs: 10_000 });
  });

  it('go through get ready and record for each phase of each variant', () => {
    expect(steps).toHaveLength(1 + VARIANTS.length * PHASES.length * 2);
    expect(steps[1]).toEqual({ kind: 'ready', variant: 0, phase: 0, durationMs: 2_000 });
    expect(steps[2]).toEqual({ kind: 'record', variant: 0, phase: 0, durationMs: 5_000 });
    expect(steps[3]).toMatchObject({ kind: 'ready', variant: 0, phase: 1 });
    expect(steps.at(-1)).toMatchObject({ kind: 'record', variant: VARIANTS.length - 1, phase: PHASES.length - 1 });
  });
});

describe('moving through the steps', () => {
  it('stays in a step until its time is up', () => {
    const run = new TestRun(ZONES, TIMING, 0);

    expect(run.advance(9_999)).toBe(false);
    expect(run.step?.kind).toBe('countdown');
    expect(run.advance(10_000)).toBe(true);
    expect(run.step).toMatchObject({ kind: 'ready', variant: 0, phase: 0 });
  });

  it('never skips a step after a late call, and gives the next step its full time', () => {
    const run = new TestRun(ZONES, TIMING, 0);

    // The page was busy for 20 s. The run still goes to the next step only.
    expect(run.advance(30_000)).toBe(true);
    expect(run.step?.kind).toBe('ready');
    expect(run.advance(31_999)).toBe(false);
    expect(run.advance(32_000)).toBe(true);
    expect(run.step?.kind).toBe('record');
  });

  it('counts down the seconds of the step', () => {
    const run = new TestRun(ZONES, TIMING, 0);

    expect(run.secondsLeft(0)).toBe(10);
    expect(run.secondsLeft(9_100)).toBe(1);
    expect(run.secondsLeft(12_000)).toBe(0);
  });

  it('names the step that comes next', () => {
    const run = runInFirstRecording();
    expect(run.upcoming).toMatchObject({ kind: 'ready', variant: 0, phase: 1 });
  });

  it('is done after the last recording', () => {
    const run = new TestRun(ZONES, TIMING, 0);
    let nowMs = 0;
    for (const step of runSteps(TIMING)) {
      nowMs += step.durationMs;
      run.advance(nowMs);
    }

    expect(run.step).toBeNull();
    expect(run.upcoming).toBeNull();
    expect(run.progress(nowMs)).toBe(1);
    expect(run.advance(nowMs + 60_000)).toBe(false);
  });

  it('reports how far the run has come', () => {
    const run = new TestRun(ZONES, TIMING, 0);
    const totalMs = 10_000 + VARIANTS.length * PHASES.length * 7_000;

    expect(run.progress(0)).toBe(0);
    expect(run.progress(5_000)).toBeCloseTo(5_000 / totalMs);
    run.advance(10_000);
    expect(run.progress(11_000)).toBeCloseTo(11_000 / totalMs);
  });
});

describe('recording', () => {
  it('keeps the frames taken inside a recording, and sums them up when it ends', () => {
    const run = runInFirstRecording();
    for (let timeMs = 12_000; timeMs < 17_000; timeMs += 50) run.record(frame(timeMs));
    run.advance(17_000);

    expect(run.summaries[0][0]).toMatchObject({ frames: 100, framesPerSec: 20 });
    expect(run.summaries[0][0].zones).toHaveLength(ZONES);
  });

  it('drops frames from the countdown and from get ready', () => {
    const run = new TestRun(ZONES, TIMING, 0);
    run.record(frame(5_000));
    run.advance(10_000);
    run.record(frame(11_000));
    run.advance(12_000);
    run.advance(17_000);

    expect(run.summaries[0][0].frames).toBe(0);
  });

  it('drops a frame taken after the recording time, when the step ended late', () => {
    const run = runInFirstRecording();
    run.record(frame(16_999));
    run.record(frame(17_000));
    run.advance(17_400);

    expect(run.summaries[0][0].frames).toBe(1);
  });

  it('starts every recording empty, and files it under its variant and phase', () => {
    const run = runInFirstRecording();
    run.record(frame(12_500));
    run.advance(17_000); // Get ready for phase 2.
    run.advance(19_000); // Recording of phase 2.
    run.record(frame(19_100));
    run.record(frame(19_200));
    run.advance(24_000);

    expect(run.summaries[0][0].frames).toBe(1);
    expect(run.summaries[0][1].frames).toBe(2);
    expect(run.summaries[1]).toEqual([]);
  });
});
