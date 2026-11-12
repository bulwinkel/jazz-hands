import { describe, expect, it } from 'vitest';
import { playLength, validateManifest } from './manifest';
import { synthetic } from './fixtures';
describe('manifest', () => {
  it('validates local data and rejects malformed fields', () => {
    const m = synthetic(); expect(validateManifest(m)).toEqual(m);
    for (const patch of [{ beats: [1, 0] }, { intensity: [] }, { firstDownbeat: -1 }, { audio: 'https://example.com/a.mp3' }, { audio: '//example.com/a' }, { bpm: NaN }, { durationSec: 0 }, { beatsPerBar: 0 }]) expect(() => validateManifest({ ...m, ...patch })).toThrow('Song manifest:');
  });
  it('uses a real bar boundary at or after 90 seconds', () => {
    const m = synthetic(128); expect(playLength(m, 'short')).toBe(90); expect(playLength(m, 'full')).toBe(120);
    expect(playLength(synthetic(100), 'short')).toBe(91.2);
  });
});
