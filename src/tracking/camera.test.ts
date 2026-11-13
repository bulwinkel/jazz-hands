import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startCamera } from './camera';

/** Stand-ins for the camera stream and the video element, which a test drives by hand. */
function setUpBrowser() {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] };
  let grant: () => void = () => {};
  const video = Object.assign(new EventTarget(), {
    muted: false,
    autoplay: false,
    playsInline: false,
    srcObject: null as unknown,
    readyState: 0,
    play: vi.fn(async () => {}),
  });
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('HTMLMediaElement', { HAVE_CURRENT_DATA: 2 });
  vi.stubGlobal('document', { createElement: () => video });
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: () => new Promise((resolve) => (grant = () => resolve(stream))) },
  });
  return { track, video, grant: () => grant() };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('camera start', () => {
  let browser: ReturnType<typeof setUpBrowser>;

  beforeEach(() => {
    browser = setUpBrowser();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('gives the video once it has a decoded frame', async () => {
    const started = startCamera(new AbortController().signal);
    browser.grant();
    await settle();
    browser.video.dispatchEvent(new Event('loadeddata'));
    await expect(started).resolves.toBe(browser.video);
    expect(browser.track.stop).not.toHaveBeenCalled();
  });

  it('stops the camera at once when the start is cancelled before the first frame', async () => {
    const start = new AbortController();
    const started = startCamera(start.signal);
    browser.grant();
    await settle();
    start.abort();
    expect(browser.track.stop).toHaveBeenCalled();
    await expect(started).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('stops a camera that opens after its start was cancelled', async () => {
    const start = new AbortController();
    const started = startCamera(start.signal);
    start.abort();
    browser.grant();
    await expect(started).rejects.toMatchObject({ name: 'AbortError' });
    expect(browser.track.stop).toHaveBeenCalled();
  });
});
