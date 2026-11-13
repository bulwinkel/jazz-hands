import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREVIEW, SONGS } from './config';
import { synthetic } from './fixtures';
import { MenuPreview, previewVolume, stopFadeVolume } from './preview';
import type { Manifest } from './types';

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

/** A stand-in for the audio of a preview. */
function fakePlayer() {
  return {
    state: { url: null, playing: false, timeSec: 0, volume: 0 },
    start: vi.fn((_url: string, _startSec: number) => {}),
    stop: vi.fn(() => {}),
    halt: vi.fn(() => {}),
  };
}

describe('menu preview', () => {
  /** Manifest loads that the test finishes by hand, in any order. */
  let loads: { url: string; finish: () => void }[];
  let player: ReturnType<typeof fakePlayer>;
  let preview: MenuPreview;

  beforeEach(() => {
    vi.useFakeTimers();
    // The preview waits on the window's timers, as in the browser.
    vi.stubGlobal('window', globalThis);
    loads = [];
    const loadManifest = (url: string) =>
      new Promise<Manifest>((resolve) => loads.push({ url, finish: () => resolve({ ...synthetic(), audio: url }) }));
    player = fakePlayer();
    preview = new MenuPreview(loadManifest, player);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Follows a song and waits until its manifest is asked for. */
  function choose(song: number): void {
    preview.follow(song);
    vi.advanceTimersByTime(PREVIEW.waitSec * 1000);
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  it('plays the song it follows once its manifest has loaded', async () => {
    choose(0);
    loads[0].finish();
    await settle();
    expect(player.start).toHaveBeenCalledTimes(1);
    expect(player.start.mock.calls[0][0]).toBe(SONGS[0].manifest);
  });

  it('starts the preview once when song A, then B, then A again load in another order', async () => {
    choose(0);
    choose(1);
    choose(0);
    expect(loads.map((load) => load.url)).toEqual([SONGS[0].manifest, SONGS[1].manifest, SONGS[0].manifest]);
    loads[2].finish();
    await settle();
    loads[0].finish();
    loads[1].finish();
    await settle();
    expect(player.start).toHaveBeenCalledTimes(1);
  });

  it('plays nothing when it stops following before the manifest has loaded', async () => {
    choose(0);
    preview.follow(null);
    loads[0].finish();
    await settle();
    expect(player.start).not.toHaveBeenCalled();
  });
});
