import { afterEach, describe, expect, it, vi } from 'vitest';
import { newSurface, pictureSize } from './surfaces';

afterEach(() => vi.unstubAllGlobals());

describe('the size of a camera picture', () => {
  it('reads a video element by its video size', () => {
    const video = { videoWidth: 1920, videoHeight: 1080, width: 320, height: 180 } as HTMLVideoElement;
    expect(pictureSize(video)).toEqual({ width: 1920, height: 1080 });
  });

  it('reads a VideoFrame by its display size', () => {
    const frame = { displayWidth: 1920, displayHeight: 1080, codedWidth: 1920, codedHeight: 1088 } as VideoFrame;
    expect(pictureSize(frame)).toEqual({ width: 1920, height: 1080 });
  });
});

describe('a new canvas', () => {
  it('is an HTML canvas on the page', () => {
    const htmlCanvas = { width: 300, height: 150 };
    vi.stubGlobal('document', { createElement: () => htmlCanvas });
    expect(newSurface()).toBe(htmlCanvas);
  });

  it('is an OffscreenCanvas in the worker, which has no document', () => {
    class FakeOffscreenCanvas {
      width = 1;
      height = 1;
    }
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    expect(newSurface()).toBeInstanceOf(FakeOffscreenCanvas);
  });
});
