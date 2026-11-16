import { describe, expect, it } from 'vitest';
import { generateChart } from './chart';
import { synthetic } from './fixtures';
import { summariseChart } from './player';

describe('the chart summary', () => {
  it('counts a slide once, not its three cells, and counts every other cue once', () => {
    const song = synthetic(100, 600);
    const cues = generateChart(song, { level: 4, shapes: true, seed: 42, endSec: song.durationSec });
    const summary = summariseChart(cues, []);
    expect(summary.slides).toBe(cues.filter((cue) => cue.slideStep === 1).length);
    expect(summary.slides).toBeGreaterThan(20);
    expect(summary.taps + summary.doubles + 3 * summary.slides).toBe(cues.length);
    expect(summary.gestures).toBe(cues.filter((cue) => cue.shapes).length);
  });
});
