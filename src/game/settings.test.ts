import { expect, it } from 'vitest';
import { parseSettings } from './settings';
it('parses stored choices and URL overrides, with safe fallbacks', () => {
  expect(parseSettings(null, '').settings.levels).toEqual([2, 1]);
  const o = parseSettings({ levels: [3, 3], inputLatencyMs: 120 }, '?p0=0&p1=1&tracker=pose&input=bot&start=185&length=full&seed=42&botAccuracy=0.5&autostart=1');
  expect(o.settings).toEqual({ levels: [0, 1], length: 'full', tracker: 'pose', inputLatencyMs: 120, avOffsetMs: 0, songIndex: 0 });
  expect(o).toMatchObject({ start: 185, seed: 42, input: 'bot', botAccuracy: 0.5, autostart: true });
  expect(parseSettings({}, '?p0=0&p1=0').settings.levels.some(Boolean)).toBe(true);
  expect(parseSettings({ levels: [-1, 9], tracker: 'bad' }, '?start=NaN&botAccuracy=NaN').start).toBe(0);
});
