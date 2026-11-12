import { describe, expect, it } from 'vitest';
import { generateChart } from './chart';
import { CHART, FACES } from './config';
import { generateFaceCues } from './faceChart';
import { synthetic } from './fixtures';
import { isBarStart, playEndSec, tailStartSec } from './manifest';
import { summariseChart } from './player';
import type { FaceCue, Level, Manifest } from './types';

const BEATS_PER_BAR = 4;
const BEATS_BETWEEN_FACES = FACES.everyBars * BEATS_PER_BAR;

function faces(song: Manifest, seed: number, endSec = song.durationSec): FaceCue[] {
  return generateFaceCues(song, seed, endSec);
}

describe('face cues', () => {
  it('sit on bar starts only, one every 2 bars', () => {
    const song = synthetic(100, 120);
    song.firstDownbeat = 3;
    const cues = faces(song, 7);
    expect(cues.length).toBeGreaterThan(10);
    for (const cue of cues) {
      expect(isBarStart(song, cue.beatIndex)).toBe(true);
      expect((cue.beatIndex - song.firstDownbeat) % BEATS_BETWEEN_FACES).toBe(0);
      expect(cue.timeSec).toBe(song.beats[cue.beatIndex]);
    }
    cues.slice(1).forEach((cue, i) => expect(cue.beatIndex - cues[i].beatIndex).toBe(BEATS_BETWEEN_FACES));
  });

  it('keep the lead-in and the last bar free, for both song lengths', () => {
    const song = synthetic();
    song.firstDownbeat = 3;
    const twoBarsIn = song.beats[3 + 2 * BEATS_PER_BAR];
    for (const endSec of [song.durationSec, playEndSec(song, 'short')]) {
      const cues = faces(song, 22, endSec);
      expect(cues.length).toBeGreaterThan(5);
      for (const cue of cues) {
        expect(cue.timeSec).toBeGreaterThanOrEqual(Math.max(CHART.leadSec, twoBarsIn));
        expect(cue.timeSec).toBeLessThan(tailStartSec(song, endSec));
      }
    }
  });

  it('appear only where the music is strong enough', () => {
    const song = synthetic(100, 120);
    const firstLoudBeat = 80;
    song.intensity = song.beats.map((_time, beat) => (beat < firstLoudBeat ? FACES.minIntensity - 0.01 : FACES.minIntensity));
    const cues = faces(song, 7);
    expect(cues.length).toBeGreaterThan(5);
    expect(cues[0].beatIndex).toBe(firstLoudBeat);
  });

  it('never ask for the same face twice in a row, and ask for every face in the pool', () => {
    const cues = faces(synthetic(100, 600), 7);
    expect(cues.length).toBeGreaterThan(100);
    cues.slice(1).forEach((cue, i) => expect(cue.expression).not.toBe(cues[i].expression));
    expect(new Set(cues.map((cue) => cue.expression))).toEqual(new Set(FACES.pool));
  });

  it('are the same list for the same seed, and another list for another seed', () => {
    const song = synthetic(100, 600);
    expect(faces(song, 7)).toEqual(faces(song, 7));
    expect(faces(song, 7)).not.toEqual(faces(song, 8));
  });

  it('are the same in the Short length as at the start of the Full length', () => {
    const song = synthetic(100, 240);
    const short = faces(song, 7, playEndSec(song, 'short'));
    const full = faces(song, 7);
    expect(short.length).toBeGreaterThan(5);
    expect(full.length).toBeGreaterThan(short.length);
    expect(full.slice(0, short.length)).toEqual(short);
  });

  it('are counted in the chart summary', () => {
    const cues = faces(synthetic(), 7);
    expect(summariseChart([], cues).faces).toBe(cues.length);
    expect(summariseChart([], []).faces).toBe(0);
  });
});

describe('hand charts', () => {
  /** FNV-1a over the JSON text: one number that changes when any cue changes. */
  function fingerprint(value: unknown): number {
    let hash = 0x811c9dc5;
    for (const char of JSON.stringify(value)) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash;
  }

  // Cue count and fingerprint of each level's chart, taken from the game without face cues.
  const BEFORE_FACES: [Level, number, number][] = [
    [1, 94, 1672571102],
    [2, 188, 2944844745],
    [3, 141, 2486315852],
    [4, 193, 2104804640],
  ];

  it.each(BEFORE_FACES)('at level %i are what they were before face cues existed', (level, count, expected) => {
    const song = synthetic(100, 120);
    const cues = generateChart(song, { level, shapes: true, seed: 42, endSec: song.durationSec });
    expect(cues).toHaveLength(count);
    expect(fingerprint(cues)).toBe(expected);
  });

  it('are the same whether or not face cues are made from the same seed', () => {
    const song = synthetic(100, 120);
    const options = { level: 3 as const, shapes: true, seed: 42, endSec: song.durationSec };
    const before = generateChart(song, options);
    faces(song, 42);
    expect(generateChart(song, options)).toEqual(before);
  });
});
