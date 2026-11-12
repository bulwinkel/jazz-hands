/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cuesFrom, generateChart } from './chart';
import { DEFAULT_SEED, SONGS } from './config';
import { playEndSec, playStartSec, validateManifest } from './manifest';
import type { Level } from './types';

/** Guards the song files themselves: a bad manifest would only show up when a player picks it. */
describe.each(SONGS)('song "$title"', (song) => {
  const manifest = validateManifest(JSON.parse(readFileSync(`public${song.manifest}`, 'utf8')));

  it('has a valid manifest with the listed title, and its audio file', () => {
    expect(manifest.title).toBe(song.title);
    expect(existsSync(`public${manifest.audio}`)).toBe(true);
  });

  it('keeps a danceable beat: every interval within 5% of the median', () => {
    const intervals = manifest.beats.slice(1).map((time, i) => time - manifest.beats[i]);
    const median = [...intervals].sort((a, b) => a - b)[Math.floor(intervals.length / 2)];
    for (const interval of intervals) {
      expect(Math.abs(interval - median) / median).toBeLessThan(0.05);
    }
  });

  it('plays a Short length of 60 to 95 seconds', () => {
    const seconds = playEndSec(manifest, 'short') - playStartSec(manifest, 'short');
    expect(seconds).toBeGreaterThan(60);
    expect(seconds).toBeLessThan(95);
  });

  it.each([1, 2, 3, 4] as Level[])('gives level %i a chart at both lengths', (level) => {
    for (const length of ['short', 'full'] as const) {
      const startSec = playStartSec(manifest, length);
      const endSec = playEndSec(manifest, length);
      const chart = generateChart(manifest, { level, shapes: true, seed: DEFAULT_SEED, endSec });
      const cues = cuesFrom(chart, startSec);
      expect(cues.length).toBeGreaterThan(30);
      expect(cues[cues.length - 1].timeSec).toBeLessThan(endSec);
    }
  });
});
