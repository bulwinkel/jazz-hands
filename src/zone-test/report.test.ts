import { describe, expect, it } from 'vitest';
import { PHASES, QUICK_TIMING, TIMING, VARIANTS } from './config';
import { buildReport } from './report';
import type { ReportInput } from './report';
import type { PhaseSummary } from './statistics';

const ZONES = 3;

/** A phase in which the person in the middle zone showed `hands` hands in every frame. */
function summary(meanMs: number, hands: 0 | 2): PhaseSummary {
  const empty = { noHands: 1, oneHand: 0, twoHands: 0, meanHandSize: null, shapeMatch: null, modelLabelMatch: null };
  const person = { ...empty, noHands: hands ? 0 : 1, twoHands: hands ? 1 : 0 };
  return {
    frames: 150,
    framesPerSec: 30,
    inferenceMs: { mean: meanMs, p95: meanMs + 4 },
    meanHands: hands,
    zones: [empty, person, empty],
  };
}

function input(overrides: Partial<ReportInput> = {}): ReportInput {
  const handsHidden = summary(20, 0);
  const handsSeen = summary(26, 2);
  return {
    zones: ZONES,
    quick: false,
    timing: TIMING,
    camera: { width: 1920, height: 1080, frameRate: 30 },
    userAgent: 'Test browser',
    savedAt: new Date('2026-11-12T08:30:00Z'),
    trackers: VARIANTS.map(() => ({ delegate: 'GPU' as const, modelCount: 1, handsPerModel: 6 })),
    summaries: VARIANTS.map(() => [handsHidden, handsSeen, handsSeen, handsSeen, handsSeen]),
    ...overrides,
  };
}

describe('the report of a run', () => {
  const report = buildReport(input());

  it('says what it is and what it was made with', () => {
    expect(report).toMatchObject({
      kind: 'zone-test',
      schemaVersion: 1,
      savedAt: '2026-11-12T08:30:00.000Z',
      userAgent: 'Test browser',
      camera: { width: 1920, height: 1080, frameRate: 30 },
      zones: ZONES,
      quick: false,
      timing: TIMING,
    });
  });

  it('holds the thresholds the run used', () => {
    expect(report.thresholds).toEqual({
      handDetection: 0.3,
      handPresence: 0.3,
      tracking: 0.3,
      cropOverlap: 0.1,
      occupiedShare: 0.5,
    });
  });

  it('holds every variant with its tracker', () => {
    expect(report.variants.map(({ layout, model }) => ({ layout, model }))).toEqual(VARIANTS);
    expect(report.variants[0]).toMatchObject({ delegate: 'GPU', modelCount: 1, handsPerModel: 6 });
  });

  it('holds every phase of a variant, numbered from 1, with its instruction', () => {
    const { phases } = report.variants[2];

    expect(phases.map((phase) => phase.phase)).toEqual([1, 2, 3, 4, 5]);
    expect(phases.map((phase) => phase.instruction)).toEqual(PHASES.map((phase) => phase.instruction));
    expect(phases[1]).toMatchObject({ expectedShape: 'open', frames: 150, meanHands: 2 });
  });

  it('derives the estimates from the phase with hidden hands and the phase with open hands', () => {
    const { derived } = report.variants[0];

    expect(derived.occupiedZones).toEqual([1]);
    expect(derived.detectorMs).toBe(20);
    expect(derived.costPerHandMs).toBe(3);
    expect(derived.estimate.everyHandTrackedMs).toBe(18);
  });

  it('says in words that the times for full zones are estimates', () => {
    expect(report.caveat).toContain('estimates');
    expect(report.caveat).not.toContain('quick run');
  });

  it('survives being written as JSON', () => {
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
});

describe('the report of a quick run', () => {
  it('says that its numbers mean nothing', () => {
    const report = buildReport(input({ quick: true, timing: QUICK_TIMING }));

    expect(report.quick).toBe(true);
    expect(report.caveat).toContain('too short for its numbers to mean anything');
  });
});

describe('a camera that does not report its rate', () => {
  it('is taken to deliver 30 frames a second', () => {
    const slowFrames = [summary(20, 0), summary(60, 2), summary(60, 2), summary(60, 2), summary(60, 2)];
    const report = buildReport(
      input({
        camera: { width: 1920, height: 1080, frameRate: null },
        summaries: VARIANTS.map(() => slowFrames),
      }),
    );
    const fastCase = buildReport(input({ camera: { width: 1920, height: 1080, frameRate: null } }));

    expect(report.variants[0].derived.estimate.everyHandTrackedFps).toBe(8.3);
    expect(fastCase.variants[0].derived.estimate.everyHandTrackedFps).toBe(30);
  });
});
