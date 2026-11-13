import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyFrame, FakeVideoFrame, FakeWorker } from './testDoubles';
import type { FakeVideo } from './testDoubles';
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

const camera: FakeVideo = { picture: 0 };
const video = camera as unknown as HTMLVideoElement;
const noFaces: [null, null] = [null, null];

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

  it('tracks on the main thread at once after a fallback, with no frame to wait for', async () => {
    FakeWorker.failToStart = true;
    const tracking = new CameraTracking('hands-full', false, 'worker');
    await tracking.init();
    const onFrame = vi.fn();
    tracking.track(video, noFaces, onFrame, vi.fn());
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(FakeVideoFrame.made).toHaveLength(0);
    expect(tracking.pendingFrameMs()).toBeUndefined();
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

/** Tracking in a worker whose tracker has loaded, with a clock the test sets. */
async function trackingInWorker() {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
  const tracking = new CameraTracking('hands-full', false, 'worker');
  const loading = tracking.init();
  loadInWorker();
  await loading;
  const onFrame = vi.fn();
  const onError = vi.fn();
  const worker = FakeWorker.last;
  /** The camera shows a new picture at page time `atMs`, and the input offers it. */
  const frameComes = (atMs: number): void => {
    clock.mockReturnValue(atMs);
    camera.picture = atMs;
    tracking.track(video, noFaces, onFrame, onError);
  };
  return { tracking, worker, onFrame, onError, frameComes, clock };
}

/** Lets promise callbacks run. */
const settle = () => new Promise((done) => setTimeout(done, 0));

describe('a camera frame in a worker', () => {
  it('goes over with the picture and the page time of the moment it came', async () => {
    const { worker, onFrame, frameComes } = await trackingInWorker();
    frameComes(100);
    const [sent] = worker.frames();
    expect(sent).toMatchObject({ timeMs: 100, picture: FakeVideoFrame.made[0] });
    worker.answerLastFrame();
    await settle();
    expect(onFrame).toHaveBeenCalledWith(expect.objectContaining({ timeMs: 100 }));
  });

  it('keeps its own picture and time while it is held, though the video moves on', async () => {
    const { worker, onFrame, frameComes, clock } = await trackingInWorker();
    frameComes(100);
    frameComes(133); // Held: the worker is busy.
    // The answer comes later, and the video shows a newer picture by then.
    clock.mockReturnValue(160);
    camera.picture = 160;
    worker.answerLastFrame();
    await settle();
    const [, held] = worker.frames();
    expect(held.timeMs).toBe(133);
    expect((held.picture as unknown as FakeVideoFrame).shows).toBe(133);
    worker.answerLastFrame();
    await settle();
    expect(onFrame.mock.calls.map(([frame]) => frame.timeMs)).toEqual([100, 133]);
  });

  it('lets an older held frame go when a newer one takes its place', async () => {
    const { worker, frameComes } = await trackingInWorker();
    frameComes(100);
    frameComes(133);
    frameComes(166);
    expect(FakeVideoFrame.made[1].closes).toBe(1);
    worker.answerLastFrame();
    await settle();
    expect(worker.frames()[1].picture).toBe(FakeVideoFrame.made[2]);
  });

  it('sends the held frame before the game handles the answer', async () => {
    const { worker, onFrame, frameComes } = await trackingInWorker();
    let framesSentWhenHandled = 0;
    onFrame.mockImplementation(() => {
      framesSentWhenHandled = worker.frames().length;
    });
    frameComes(100);
    frameComes(133);
    worker.answerLastFrame();
    await settle();
    expect(framesSentWhenHandled).toBe(2);
  });

  it('delivers nothing after a dispose, and lets the held frame go', async () => {
    const { tracking, worker, onFrame, onError, frameComes } = await trackingInWorker();
    frameComes(100);
    frameComes(133);
    tracking.dispose();
    worker.answer({ type: 'tracked', frame: 1, result: emptyFrame(100) });
    await settle();
    expect(onFrame).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(FakeVideoFrame.made[1].closes).toBe(1);
  });

  it('lets a frame go when its tracker broke, and reports the failure', async () => {
    const { worker, onError, frameComes } = await trackingInWorker();
    frameComes(100);
    frameComes(133);
    worker.breakDown('lost the GPU');
    await settle();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'The tracking worker failed: lost the GPU' }));
    // The held frame went to the broken tracker, which let it go on the page.
    expect(FakeVideoFrame.made[1].closes).toBe(1);
  });

  it('names the time of the oldest frame whose result is still to come', async () => {
    const { tracking, worker, frameComes } = await trackingInWorker();
    expect(tracking.pendingFrameMs()).toBeUndefined();
    frameComes(100);
    frameComes(133);
    expect(tracking.pendingFrameMs()).toBe(100);
    worker.answerLastFrame();
    await settle();
    expect(tracking.pendingFrameMs()).toBe(133);
    worker.answerLastFrame();
    await settle();
    expect(tracking.pendingFrameMs()).toBeUndefined();
  });

  it('lets every picture go exactly once: closed on the page, or moved to the worker', async () => {
    const { tracking, worker, frameComes } = await trackingInWorker();
    for (let i = 0; i < 12; i++) {
      frameComes(100 + i * 33);
      if (i % 3 === 2) {
        worker.answerLastFrame();
        await settle();
      }
    }
    frameComes(600); // A frame that is held at the dispose.
    tracking.dispose();
    expect(FakeVideoFrame.made.map((frame) => frame.releases)).toEqual(FakeVideoFrame.made.map(() => 1));
  });
});
