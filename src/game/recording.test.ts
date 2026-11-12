import { describe, expect, it } from 'vitest';
import { nextFrameDue, pickFormat, sizeText, videoFileName, videoSize } from './recording';

describe('video format', () => {
  it('is MP4 with H.264 and AAC when the browser can record it', () => {
    expect(pickFormat(() => true)).toEqual({ mimeType: 'video/mp4;codecs=avc1.640028,mp4a.40.2', extension: 'mp4' });
  });

  it('is plain MP4 when the browser takes no codec names', () => {
    expect(pickFormat((type) => type === 'video/mp4' || type.startsWith('video/webm'))?.mimeType).toBe('video/mp4');
  });

  it('is WebM when the browser records no MP4', () => {
    const format = pickFormat((type) => type.startsWith('video/webm'));
    expect(format).toEqual({ mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' });
  });

  it('is nothing when the browser records no video', () => {
    expect(pickFormat(() => false)).toBeNull();
  });
});

describe('video file name', () => {
  it('holds the song, the local date and time, and the kind of video', () => {
    const at = new Date(2026, 10, 12, 20, 41, 7);
    expect(videoFileName('todo-bueno', at, 'game', 'mp4')).toBe('kitchen-disco-todo-bueno-2026-11-12-204107-game.mp4');
    expect(videoFileName('todo-bueno', at, 'camera', 'webm')).toBe(
      'kitchen-disco-todo-bueno-2026-11-12-204107-camera.webm',
    );
  });

  it('writes one-digit months, days, hours, minutes and seconds with two digits', () => {
    const at = new Date(2027, 0, 3, 7, 5, 9);
    expect(videoFileName('song', at, 'game', 'mp4')).toBe('kitchen-disco-song-2027-01-03-070509-game.mp4');
  });
});

describe('video size', () => {
  it('follows the shape of the camera picture', () => {
    expect(videoSize(16 / 9, 720)).toEqual({ width: 1280, height: 720 });
    expect(videoSize(4 / 3, 720)).toEqual({ width: 960, height: 720 });
  });

  it('is even in both directions, as video encoders need', () => {
    for (const aspect of [1.5, 1.6, 1.777, 1.85, 2.1]) {
      const { width, height } = videoSize(aspect, 721);
      expect(width % 2).toBe(0);
      expect(height % 2).toBe(0);
      expect(width / height).toBeCloseTo(aspect, 1);
    }
  });
});

describe('file size text', () => {
  it('gives one decimal under 10 MB and whole megabytes above', () => {
    expect(sizeText(422_225)).toBe('0.4 MB');
    expect(sizeText(9_440_000)).toBe('9.4 MB');
    expect(sizeText(45_300_000)).toBe('45 MB');
  });
});

describe('game view pacing', () => {
  /** Counts the frames drawn in ten seconds of display frames at `hz`, for a video of 30 frames a second. */
  function framesDrawn(hz: number): number {
    let dueMs = 0;
    let drawn = 0;
    for (let frame = 0; frame < hz * 10; frame++) {
      const next = nextFrameDue(dueMs, 1000 + (frame * 1000) / hz, 30);
      if (next === null) continue;
      dueMs = next;
      drawn++;
    }
    return drawn;
  }

  it.each([60, 120, 144])('draws the frames the video takes on a %d Hz screen, and no more', (hz) => {
    expect(Math.abs(framesDrawn(hz) - 300)).toBeLessThanOrEqual(1);
  });

  it('draws every display frame when the screen is slower than the video', () => {
    expect(framesDrawn(24)).toBe(240);
  });

  it('counts on from now after a long gap, with no burst of frames', () => {
    const next = nextFrameDue(1000, 5000, 30);
    expect(next).toBeCloseTo(5000 + 1000 / 30);
    expect(nextFrameDue(next ?? 0, 5017, 30)).toBeNull();
  });
});
