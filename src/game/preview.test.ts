import { describe, expect, it } from 'vitest';
import { PREVIEW } from './config';
import { previewVolume, stopFadeVolume } from './preview';

describe('preview volume', () => {
  it('starts silent and fades in', () => {
    expect(previewVolume(0)).toBe(0);
    expect(previewVolume(PREVIEW.fadeInSec / 2)).toBeCloseTo(PREVIEW.volume / 2);
  });

  it('plays at the preview volume between the fades', () => {
    expect(previewVolume(PREVIEW.lengthSec / 2)).toBe(PREVIEW.volume);
  });

  it('fades out before the end of the part', () => {
    expect(previewVolume(PREVIEW.lengthSec - PREVIEW.fadeOutSec / 2)).toBeCloseTo(PREVIEW.volume / 2);
  });

  it('is over at the end of the part, so the part can start again', () => {
    expect(previewVolume(PREVIEW.lengthSec)).toBeNull();
    expect(previewVolume(PREVIEW.lengthSec + 3)).toBeNull();
  });

  it('is never above the preview volume', () => {
    for (let playedSec = 0; playedSec < PREVIEW.lengthSec; playedSec += 0.1) {
      expect(previewVolume(playedSec)).toBeLessThanOrEqual(PREVIEW.volume);
    }
  });
});

describe('stop fade', () => {
  it('goes from the volume of that moment down to silence', () => {
    const fadeMs = PREVIEW.stopFadeSec * 1000;
    expect(stopFadeVolume(0.5, 0)).toBe(0.5);
    expect(stopFadeVolume(0.5, fadeMs / 2)).toBeCloseTo(0.25);
    expect(stopFadeVolume(0.5, fadeMs)).toBeNull();
  });
});
