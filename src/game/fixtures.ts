import { CHART } from './config';
import type { Cue, Manifest } from './types';

/** A steady test song: a beat every 60 / bpm seconds, all at one intensity. */
export function synthetic(bpm = 100, seconds = 120, intensity = 0.8): Manifest {
  const beatCount = Math.floor((seconds * bpm) / 60);
  const beats = Array.from({ length: beatCount }, (_, beat) => (beat * 60) / bpm);
  return {
    id: 'synthetic',
    title: 'Test',
    audio: '/test.mp3',
    durationSec: seconds,
    bpm,
    beatsPerBar: 4,
    firstDownbeat: 0,
    beats,
    intensity: beats.map(() => intensity),
  };
}

/**
 * Checks a chart against two hands, with its own bookkeeping: every cue cell must find a hand
 * that has had `CHART.handRestSec` since its last target. A slide is one hand's move.
 * Returns the cues that do not fit.
 */
export function cuesBeyondTwoHands(cues: Cue[]): Cue[] {
  const lastTargetSec = [-Infinity, -Infinity];
  const takeFreeHand = (atSec: number, untilSec: number): boolean => {
    const hand = lastTargetSec.findIndex((last) => atSec - last >= CHART.handRestSec - 1e-8);
    if (hand === -1) return false;
    lastTargetSec[hand] = untilSec;
    return true;
  };
  return cues.filter((cue) => {
    if (cue.kind === 'slide') return !takeFreeHand(cue.timeSec, cue.times[cue.times.length - 1]);
    const fits = cue.cells.map(() => takeFreeHand(cue.timeSec, cue.timeSec));
    return fits.includes(false);
  });
}
