/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cuesFrom, generateChart } from './chart';
import { CHART, DEFAULT_SEED, FACES, SONGS } from './config';
import { barsBetweenFaceCues, generateFaceCues } from './faceChart';
import { synthetic } from './fixtures';
import { isBarStart, playEndSec, playStartSec, tailStartSec, validateManifest } from './manifest';
import { summariseChart } from './player';
import type { FaceCue, Level, Manifest } from './types';

const BEATS_PER_BAR = 4;
const barSecAt = (bpm: number): number => (60 / bpm) * BEATS_PER_BAR;
/** The tests below use 100 BPM, unless they say otherwise. Its bars are 2.4 s long. */
const BEATS_BETWEEN_FACES = barsBetweenFaceCues(barSecAt(100)) * BEATS_PER_BAR;

function faces(song: Manifest, seed: number, endSec = song.durationSec): FaceCue[] {
  return generateFaceCues(song, seed, endSec);
}

describe('the gap between face cues', () => {
  it.each([
    [40, 1], // One bar of 6 s is already long enough.
    [95, 2],
    [96, 2], // Two bars of 2.5 s are exactly the 5 s gap.
    [102, 3],
    [130, 3],
    [180, 4],
  ])('at %i BPM is %i bars', (bpm, bars) => {
    expect(barsBetweenFaceCues(barSecAt(bpm))).toBe(bars);
  });

  it('is never under the minimum, and never a whole bar over it', () => {
    for (const bpm of [80, 95, 102, 130, 150, 180]) {
      const cues = faces(synthetic(bpm, 300), 7);
      expect(cues.length).toBeGreaterThan(20);
      cues.slice(1).forEach((cue, i) => {
        const gapSec = cue.timeSec - cues[i].timeSec;
        expect(gapSec).toBeGreaterThanOrEqual(FACES.minGapSec - 1e-6);
        expect(gapSec).toBeLessThan(FACES.minGapSec + barSecAt(bpm));
      });
    }
  });
});

describe.each(SONGS)('face cues of the song "$title"', (song) => {
  const manifest = validateManifest(JSON.parse(readFileSync(`public${song.manifest}`, 'utf8')));

  it.each(['short', 'full'] as const)('are at least the minimum gap apart at the %s length', (length) => {
    const all = faces(manifest, DEFAULT_SEED, playEndSec(manifest, length));
    const cues = cuesFrom(all, playStartSec(manifest, length));
    expect(cues.length).toBeGreaterThan(5);
    cues.slice(1).forEach((cue, i) => {
      expect(cue.timeSec - cues[i].timeSec).toBeGreaterThanOrEqual(FACES.minGapSec);
    });
  });
});

describe('face cues', () => {
  it('sit on bar starts only, one every few bars', () => {
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
    const firstLoudBeat = 7 * BEATS_BETWEEN_FACES;
    song.intensity = song.beats.map((_time, beat) => (beat < firstLoudBeat ? FACES.minIntensity - 0.01 : FACES.minIntensity));
    const cues = faces(song, 7);
    expect(cues.length).toBeGreaterThan(5);
    expect(cues[0].beatIndex).toBe(firstLoudBeat);
  });

  it('never ask for the same face twice in a row, and ask for every face in the pool', () => {
    const cues = faces(synthetic(100, 600), 7);
    expect(cues.length).toBeGreaterThan(50);
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
  it('are the same whether or not face cues are made from the same seed', () => {
    const song = synthetic(100, 120);
    for (const level of [1, 2, 3, 4] as Level[]) {
      const options = { level, shapes: true, seed: 42, endSec: song.durationSec };
      const before = generateChart(song, options);
      faces(song, 42);
      expect(generateChart(song, options)).toEqual(before);
    }
  });
});
