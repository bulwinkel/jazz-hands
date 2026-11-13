import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyFrame, FakeVideoFrame, FakeWorker } from './testDoubles';
import type { Tracker, TrackerMode, TrackerOptions } from './types';

/** Trackers on the main thread, made by `createTracker`. They load at once. */
const { pageTrackers } = vi.hoisted(() => ({ pageTrackers: [] as (Tracker & { dispose: () => void })[] }));

vi.mock('./index', () => ({
  createTracker: (mode: TrackerMode, options: TrackerOptions = {}): Tracker => {
    let loaded = false;
    const tracker = {
      mode,
      get delegate() {
        return loaded ? ('GPU' as const) : ('uninitialized' as const);
      },
      get faceDelegate() {
        return options.faces && loaded ? ('GPU' as const) : ('uninitialized' as const);
      },
      init: async () => {
        loaded = true;
      },
      process: vi.fn((_picture: unknown, nowMs: number) => emptyFrame(nowMs)),
      dispose: vi.fn(),
    };
    pageTrackers.push(tracker);
    return tracker;
  },
}));

const { CameraTracking } = await import('./cameraTracking');

const video = {} as HTMLVideoElement;
const noFaces = () => [null, null] as [null, null];

beforeEach(() => {
  pageTrackers.length = 0;
  FakeWorker.reset();
  FakeVideoFrame.made = [];
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('VideoFrame', FakeVideoFrame);
  vi.stubGlobal('OffscreenCanvas', class {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Lets the worker of the last tracker answer its load. */
function loadInWorker(): void {
  FakeWorker.last.answer({ type: 'loaded', delegate: 'GPU', faceDelegate: 'uninitialized' });
}

describe('the thread of the trackers', () => {
  it('runs every tracker on the main thread when the main thread is asked for', async () => {
    const tracking = new CameraTracking('hands-full', false, 'main');
    await tracking.init();
    expect(tracking.current.thread).toBe('main');
    expect(FakeWorker.made).toHaveLength(0);
  });

  it('runs a tracker in a worker of its own when the workers are asked for', async () => {
    const tracking = new CameraTracking('hands-full', false, 'worker');
    const loading = tracking.init();
    loadInWorker();
    await loading;
    expect(tracking.current).toMatchObject({ thread: 'worker', delegate: 'GPU' });
    expect(pageTrackers).toHaveLength(0);
  });
});

describe('the fallback to the main thread', () => {
  it('loads a tracker on the main thread when its worker cannot be made', async () => {
    FakeWorker.failToStart = true;
    const tracking = new CameraTracking('hands-full', false, 'worker');
    await tracking.init();
    expect(tracking.current).toMatchObject({ thread: 'main', delegate: 'GPU' });
  });

  it('loads the first tracker on the main thread when its worker cannot load it', async () => {
    const tracking = new CameraTracking('hands-full', false, 'worker');
    const loading = tracking.init();
    FakeWorker.last.answer({ type: 'loadFailed', error: 'No WebGL in workers.' });
    await loading;
    expect(tracking.current).toMatchObject({ thread: 'main', delegate: 'GPU' });
    expect(FakeWorker.last.terminated).toBe(true);
  });

  it('loads a later tracker on the main thread when its worker cannot load it', async () => {
    // Hand control loaded the menu's tracker in a worker. The round's tracker then fails there.
    const tracking = new CameraTracking('hands-full', false, 'worker');
    const loading = tracking.init();
    loadInWorker();
    await loading;
    const switching = tracking.setMode('hands-split', false);
    FakeWorker.last.answer({ type: 'loadFailed', error: 'Out of GPU memory.' });
    await switching;
    expect(tracking.current).toMatchObject({ mode: 'hands-split', thread: 'main', delegate: 'GPU' });
  });

  it('tracks on the main thread at once after a fallback', async () => {
    FakeWorker.failToStart = true;
    const tracking = new CameraTracking('hands-full', false, 'worker');
    await tracking.init();
    const onFrame = vi.fn();
    tracking.track(video, noFaces, onFrame, vi.fn());
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(FakeVideoFrame.made).toHaveLength(0);
  });

  it('does not fall back for a tracker that was disposed while its worker loaded', async () => {
    const tracking = new CameraTracking('hands-full', false, 'worker');
    const loading = tracking.init();
    tracking.dispose();
    await expect(loading).rejects.toThrow('Tracker is disposed.');
    expect(pageTrackers).toHaveLength(0);
  });
});

describe('disposing the trackers', () => {
  it('ends the worker of a tracker that still loads, before its load ends', async () => {
    const tracking = new CameraTracking('hands-full', false, 'worker');
    const loading = tracking.init();
    loadInWorker();
    await loading;
    void tracking.setMode('pose', false).catch(() => {});
    const poseWorker = FakeWorker.last;
    tracking.dispose();
    expect(poseWorker.terminated).toBe(true);
  });
});
