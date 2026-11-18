import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACKING_THREAD } from './config';
import { defaultSettings, parseSettings, usesFaces } from './settings';

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
      faces: [false, true],
      length: 'full',
      inputLatencyMs: 120,
      avOffsetMs: -30,
      songIndex: 0,
      previews: false,
      handControl: false,
      record: true,
      cueSet: 4,
      introSeen: true,
    };
    expect(parseSettings(kept, '').settings).toEqual(kept);
  });

  it('read the intro as not seen until a visitor has left it, also from settings kept before it existed', () => {
    expect(parseSettings(null, '').settings.introSeen).toBe(false);
    const beforeIntro = { playerCount: 1, songIndex: 0, record: false, cueSet: 2 };
    expect(parseSettings(beforeIntro, '').settings.introSeen).toBe(false);
    expect(parseSettings({ introSeen: false }, '').settings.introSeen).toBe(false);
    expect(parseSettings({ introSeen: true }, '').settings.introSeen).toBe(true);
  });

  it('ignore an intro mark that is not a switch', () => {
    expect(parseSettings({ introSeen: 'yes' }, '').settings.introSeen).toBe(false);
    expect(parseSettings({ introSeen: 1 }, '').settings.introSeen).toBe(false);
  });

  it('keep previews and hand control on for settings kept before those switches existed', () => {
    const { settings } = parseSettings({ playerCount: 1, songIndex: 0 }, '');
    expect(settings).toMatchObject({ previews: true, handControl: true });
  });

  it('ignore a previews or hand control value that is not a switch', () => {
    const { settings } = parseSettings({ previews: 0, handControl: 'no' }, '');
    expect(settings).toMatchObject({ previews: true, handControl: true });
  });

  it('keep faces off for settings kept before faces existed', () => {
    const beforeFaces = {
      playerCount: 1,
      levels: [3, 2],
      shapes: [true, false],
      length: 'full',
      inputLatencyMs: 120,
      avOffsetMs: -30,
      songIndex: 0,
    };
    const { settings } = parseSettings(beforeFaces, '');
    expect(settings.faces).toEqual([false, false]);
    expect(settings).toMatchObject(beforeFaces);
  });

  it('ignore a faces value that is not a switch', () => {
    expect(parseSettings({ faces: 'yes' }, '').settings.faces).toEqual([false, false]);
    expect(parseSettings({ faces: [1, true] }, '').settings.faces).toEqual([false, true]);
  });

  it('survive settings kept by the first version of the game', () => {
    // That version had an "Off" level (0), no player count and a kept tracker mode.
    const old = { levels: [0, 3], length: 'full', tracker: 'pose', inputLatencyMs: 140, avOffsetMs: 0, songIndex: 0 };
    const options = parseSettings(old, '');
    expect(options.settings).toMatchObject({ playerCount: 2, levels: [2, 3], shapes: [false, false], length: 'full' });
    expect(options.settings.inputLatencyMs).toBe(140);
    expect(options.tracker).toBeUndefined();
  });

  it('ignore the cue style that older versions kept, and its URL parameter', () => {
    const { settings } = parseSettings({ cueStyle: 'grow' }, '?cues=shrink');
    expect(settings).toEqual(defaultSettings());
    expect(settings).not.toHaveProperty('cueStyle');
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

  it('accept every level from 1 to 5', () => {
    expect(parseSettings(null, '?p0=5&p1=1').settings.levels).toEqual([5, 1]);
    expect(parseSettings(null, '?p0=6').settings.levels).toEqual(defaultSettings().levels);
  });

  it('switch faces on and off for each player', () => {
    expect(parseSettings(null, '').settings.faces).toEqual([false, false]);
    expect(parseSettings(null, '?faces0=1').settings.faces).toEqual([true, false]);
    expect(parseSettings(null, '?faces1=1').settings.faces).toEqual([false, true]);
    expect(parseSettings(null, '?faces0=1&faces1=1').settings.faces).toEqual([true, true]);
    expect(parseSettings({ faces: [true, true] }, '?faces0=0').settings.faces).toEqual([false, true]);
  });

  it('switch song previews and hand control on and off', () => {
    expect(parseSettings(null, '?previews=0').settings).toMatchObject({ previews: false, handControl: true });
    expect(parseSettings(null, '?hands=0').settings).toMatchObject({ previews: true, handControl: false });
    const kept = { previews: false, handControl: false };
    expect(parseSettings(kept, '?previews=1&hands=1').settings).toMatchObject({ previews: true, handControl: true });
  });

  it('keep recording off until a player turns it on', () => {
    expect(parseSettings(null, '').settings.record).toBe(false);
    expect(parseSettings({ record: 'yes' }, '').settings.record).toBe(false);
    expect(parseSettings(null, '?record=1').settings.record).toBe(true);
    expect(parseSettings({ record: true }, '?record=0').settings.record).toBe(false);
  });

  it('track on the default thread unless the URL names one', () => {
    expect(parseSettings(null, '').thread).toBe(DEFAULT_TRACKING_THREAD);
    expect(parseSettings(null, '?thread=main').thread).toBe('main');
    expect(parseSettings(null, '?thread=worker').thread).toBe('worker');
    expect(parseSettings(null, '?thread=other').thread).toBe(DEFAULT_TRACKING_THREAD);
  });

  it('keep a frame log only when the URL asks for one', () => {
    expect(parseSettings(null, '').frameLog).toBe(false);
    expect(parseSettings(null, '?framelog=1').frameLog).toBe(true);
  });

  it('pick the cue set at random until a player picks a set', () => {
    expect(parseSettings(null, '').settings.cueSet).toBe('random');
  });

  it('keep a kept cue set from 1 to 6, or random, and ignore any other value', () => {
    const kept = (cueSet: unknown) => parseSettings({ cueSet }, '').settings.cueSet;
    expect([1, 4, 6, 'random'].map(kept)).toEqual([1, 4, 6, 'random']);
    expect([0, 7, 2.5, '2', 'Random', null].map(kept)).toEqual(Array(6).fill('random'));
  });

  it('take a cue set from 1 to 6, or random, from the URL, and ignore any other value', () => {
    const fromUrl = (query: string) => parseSettings({ cueSet: 5 }, query).settings.cueSet;
    expect(['?set=1', '?set=3', '?set=6', '?set=random'].map(fromUrl)).toEqual([1, 3, 6, 'random']);
    expect(parseSettings({ cueSet: 'random' }, '?set=2').settings.cueSet).toBe(2);
    const ignored = ['', '?set=', '?set=0', '?set=7', '?set=2.5', '?set=Random', '?set=any'];
    expect(ignored.map(fromUrl)).toEqual(Array(ignored.length).fill(5));
  });

  it('give a share of moves only when the URL names one, from 0 to 1', () => {
    expect(parseSettings(null, '').moves).toBeUndefined();
    expect(parseSettings(null, '?seed=42').moves).toBeUndefined();
    expect(parseSettings(null, '?moves=0.35').moves).toBe(0.35);
    expect(parseSettings(null, '?seed=42&moves=1').moves).toBe(1);
    expect(parseSettings(null, '?moves=2').moves).toBe(1);
    expect(parseSettings(null, '?moves=-1').moves).toBe(0);
    expect(parseSettings(null, '?moves=lots').moves).toBeUndefined();
  });

  it('give a chart seed only when the URL names one, so the cue set picks it otherwise', () => {
    expect(parseSettings(null, '').seed).toBeUndefined();
    expect(parseSettings(null, '?set=3&seed=42')).toMatchObject({ seed: 42, settings: { cueSet: 3 } });
  });

  it('show or hide the intro at page load only when the URL says so, and keep neither', () => {
    expect(parseSettings(null, '').intro).toBeUndefined();
    expect(parseSettings(null, '?intro=1').intro).toBe(true);
    expect(parseSettings(null, '?intro=0').intro).toBe(false);
    expect(parseSettings(null, '?intro=yes').intro).toBeUndefined();
    // The URL never changes the kept mark: that is for the intro's own ways out.
    expect(parseSettings({ introSeen: true }, '?intro=1').settings.introSeen).toBe(true);
    expect(parseSettings(null, '?intro=0').settings.introSeen).toBe(false);
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
    expect(options.seed).toBeUndefined();
  });
});

describe('whether a session uses faces', () => {
  const withFaces = (playerCount: 1 | 2, faces: [boolean, boolean]) => ({ ...defaultSettings(), playerCount, faces });

  it('is true when a player in the session has faces on', () => {
    expect(usesFaces(withFaces(2, [false, false]))).toBe(false);
    expect(usesFaces(withFaces(2, [true, false]))).toBe(true);
    expect(usesFaces(withFaces(2, [false, true]))).toBe(true);
    expect(usesFaces(withFaces(1, [true, false]))).toBe(true);
  });

  it('ignores the second switch with one player', () => {
    expect(usesFaces(withFaces(1, [false, true]))).toBe(false);
  });
});
