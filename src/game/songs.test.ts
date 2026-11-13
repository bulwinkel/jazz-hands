/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cuesFrom, generateChart } from './chart';
import { DEFAULT_SEED, PREVIEW, SONGS } from './config';
import { cuesBeyondTwoHands } from './fixtures';
import { isBarStart, playEndSec, playStartSec, previewStartSec, validateManifest } from './manifest';
import type { Level } from './types';

/** Guards the song files themselves: a bad manifest would only show up when a player picks it. */
describe.each(SONGS)('song "$title"', (song) => {
  const manifest = validateManifest(JSON.parse(readFileSync(`public${song.manifest}`, 'utf8')));

  it('has a valid manifest with the listed title, and its audio file', () => {
    expect(manifest.title).toBe(song.title);
    expect(existsSync(`public${manifest.audio}`)).toBe(true);
  });

  it('has its cover picture, when it lists one', () => {
    if (song.cover) expect(existsSync(`public${song.cover}`)).toBe(true);
  });

  it('previews a whole part that starts on a bar start', () => {
    const startSec = previewStartSec(manifest);
    expect(isBarStart(manifest, manifest.beats.indexOf(startSec))).toBe(true);
    expect(startSec + PREVIEW.lengthSec).toBeLessThanOrEqual(manifest.durationSec);
  });

  it('previews a part that is livelier than the song as a whole', () => {
    const startSec = previewStartSec(manifest);
    const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
    const part = manifest.intensity.filter((_, beat) => {
      const time = manifest.beats[beat];
      return time >= startSec && time < startSec + PREVIEW.lengthSec;
    });
    expect(mean(part)).toBeGreaterThan(mean(manifest.intensity));
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

  it.each([1, 2, 3, 4, 5] as Level[])('gives level %i a chart at both lengths that two hands can play', (level) => {
    for (const length of ['short', 'full'] as const) {
      const startSec = playStartSec(manifest, length);
      const endSec = playEndSec(manifest, length);
      const chart = generateChart(manifest, { level, shapes: true, seed: DEFAULT_SEED, endSec });
      const cues = cuesFrom(chart, startSec);
      expect(cues.length).toBeGreaterThan(30);
      expect(cues[cues.length - 1].timeSec).toBeLessThan(endSec);
      expect(cuesBeyondTwoHands(cues)).toEqual([]);
    }
  });
});
