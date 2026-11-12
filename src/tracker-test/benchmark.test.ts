import { expect, it } from 'vitest';
import { BenchmarkSession } from './benchmark';
import type { TrackingFrame } from '../tracking/types';

const frame = (timeMs: number): TrackingFrame => ({ timeMs, inferenceMs: 10, players: [{ hands: [] }, { hands: [] }] });

it('records only the five-second window and runs all fifteen phases in order', () => {
  const session = new BenchmarkSession(0);
  expect(session.secondsRemaining(0)).toBe(8);
  expect(session.advance(7999)).toBe(false);
  expect(session.advance(8000)).toBe(true);
  session.record(frame(9000), 'hands-full'); // get ready is excluded
  expect(session.advance(10000)).toBe(true);
  session.record(frame(9999), 'hands-full');
  session.record(frame(10000), 'hands-full');
  session.record(frame(14999), 'hands-full');
  session.record(frame(12000), 'hands-split'); // wrong mode is excluded
  session.record(frame(15000), 'hands-full'); // end is exclusive
  session.advance(15000);
  expect(session.results[0].players[0].recordedFrameCount).toBe(2);
  let now = 15000;
  while (session.stage !== 'done') {
    now += session.stageDurationMs;
    session.advance(now);
  }
  expect(session.results.map((result) => `${result.mode}:${result.phase}`)).toEqual(
    ['hands-full', 'hands-split', 'pose'].flatMap((mode) => [1, 2, 3, 4, 5].map((phase) => `${mode}:${phase}`)));
  expect(now).toBe(113000);
  expect(session.progress(now)).toBe(1);
});

it('gives each phase its full duration after a delayed transition', () => {
  const session = new BenchmarkSession(0);
  session.advance(20000);
  expect(session.stage).toBe('ready');
  expect(session.stageStartedMs).toBe(20000);
  expect(session.advance(21999)).toBe(false);
  session.advance(22000);
  expect(session.stage).toBe('recording');
  expect(session.results).toHaveLength(0);
});
