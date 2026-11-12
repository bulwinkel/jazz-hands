import { describe, expect, it } from 'vitest';
import { defaultSettings, parseSettings } from './settings';

describe('kept settings', () => {
  it('fall back to the defaults when nothing is kept', () => {
    const options = parseSettings(null, '');
    expect(options.settings).toEqual(defaultSettings());
    expect(options.settings).toMatchObject({ playerCount: 2, levels: [2, 1], shapes: [false, false], length: 'short' });
    expect(options).toMatchObject({ input: 'camera', tracker: undefined, startSec: 0, autostart: false, botAccuracy: 1 });
  });

  it('are read back', () => {
    const kept = {
      playerCount: 1,
      levels: [3, 2],
      shapes: [true, false],
      length: 'full',
      inputLatencyMs: 120,
      avOffsetMs: -30,
      songIndex: 0,
    };
    expect(parseSettings(kept, '').settings).toEqual(kept);
  });

  it('survive settings kept by the first version of the game', () => {
    // That version had an "Off" level (0), no player count and a kept tracker mode.
    const old = { levels: [0, 3], length: 'full', tracker: 'pose', inputLatencyMs: 140, avOffsetMs: 0, songIndex: 0 };
    const options = parseSettings(old, '');
    expect(options.settings).toMatchObject({ playerCount: 2, levels: [2, 3], shapes: [false, false], length: 'full' });
    expect(options.settings.inputLatencyMs).toBe(140);
    expect(options.tracker).toBeUndefined();
  });

  it('ignore invalid values field by field', () => {
    const broken = { playerCount: 3, levels: [9, 'x'], shapes: 'yes', length: 7, inputLatencyMs: NaN, songIndex: 99 };
    expect(parseSettings(broken, '').settings).toEqual(defaultSettings());
    expect(parseSettings('not an object', '').settings).toEqual(defaultSettings());
  });
});

describe('URL parameters', () => {
  it('override the kept settings', () => {
    const options = parseSettings(
      { levels: [1, 1], inputLatencyMs: 120 },
      '?players=1&p0=3&p1=2&shapes0=1&shapes1=0&length=full&song=1',
    );
    expect(options.settings).toMatchObject({
      playerCount: 1,
      levels: [3, 2],
      shapes: [true, false],
      length: 'full',
      songIndex: 1,
      inputLatencyMs: 120,
    });
  });

  it('accept every level from 1 to 4', () => {
    expect(parseSettings(null, '?p0=4&p1=1').settings.levels).toEqual([4, 1]);
    expect(parseSettings(null, '?p0=5').settings.levels).toEqual(defaultSettings().levels);
  });

  it('set the one-off options', () => {
    const options = parseSettings(null, '?tracker=pose&input=bot&start=185&seed=42&botAccuracy=0.5&autostart=1');
    expect(options).toMatchObject({
      tracker: 'pose',
      input: 'bot',
      startSec: 185,
      seed: 42,
      botAccuracy: 0.5,
      autostart: true,
    });
  });

  it('are ignored when invalid', () => {
    const options = parseSettings(null, '?players=4&p0=0&p1=9&length=long&song=99&tracker=bad&input=x&start=NaN&seed=1.5&botAccuracy=NaN');
    expect(options.settings).toEqual(defaultSettings());
    expect(options).toMatchObject({ tracker: undefined, input: 'camera', startSec: 0, botAccuracy: 1 });
    expect(options.seed).toBe(parseSettings(null, '').seed);
  });
});
