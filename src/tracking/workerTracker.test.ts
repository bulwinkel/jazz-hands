import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WORKER_LIMITS } from './config';
import { emptyFrame, FakeWorker } from './testDoubles';
import { WorkerTracker } from './workerTracker';

const picture = (): VideoFrame => ({ close: vi.fn() }) as unknown as VideoFrame;
const result = emptyFrame;

beforeEach(() => {
  FakeWorker.reset();
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a tracker in a worker', () => {
  it('starts a module worker of its own, as the WASM loader needs', () => {
    new WorkerTracker('hands-full', false);
    new WorkerTracker('hands-split', true);
    expect(FakeWorker.made).toHaveLength(2);
    expect(FakeWorker.last.options.type).toBe('module');
  });
});

describe('loading a tracker in its worker', () => {
  it('reads the delegates the worker reports once the tracker has loaded', async () => {
    const tracker = new WorkerTracker('hands-split', true);
    const loading = tracker.init();
    expect(tracker.delegate).toBe('uninitialized');
    expect(FakeWorker.last.posted[0].request).toEqual({ type: 'load', mode: 'hands-split', faces: true });

    FakeWorker.last.answer({ type: 'loaded', delegate: 'GPU', faceDelegate: 'GPU' });
    await loading;
    expect(tracker.delegate).toBe('GPU');
    expect(tracker.faceDelegate).toBe('GPU');
  });

  it('loads once, however often init is called', () => {
    const tracker = new WorkerTracker('hands-full', false);
    expect(tracker.init()).toBe(tracker.init());
    expect(FakeWorker.last.posted).toHaveLength(1);
  });

  it('rejects with the reason the worker gives', async () => {
    const tracker = new WorkerTracker('pose', false);
    const loading = tracker.init();
    FakeWorker.last.answer({ type: 'loadFailed', error: 'No model file.' });
    await expect(loading).rejects.toThrow('No model file.');
  });

  it('rejects a load that the tracker was disposed during, and ends the worker', async () => {
    const tracker = new WorkerTracker('hands-full', false);
    const loading = tracker.init();
    tracker.dispose();
    expect(FakeWorker.last.terminated).toBe(true);
    await expect(loading).rejects.toThrow('Tracker is disposed.');
    expect(tracker.delegate).toBe('uninitialized');
    await expect(tracker.init()).rejects.toThrow('Tracker is disposed.');
  });

  it('rejects a load whose answer came just before the dispose', async () => {
    const tracker = new WorkerTracker('hands-full', false);
    const loading = tracker.init();
    FakeWorker.last.answer({ type: 'loaded', delegate: 'GPU', faceDelegate: 'uninitialized' });
    tracker.dispose();
    await expect(loading).rejects.toThrow('Tracker is disposed.');
    expect(tracker.delegate).toBe('uninitialized');
  });

  it('reads uninitialized delegates after a dispose', async () => {
    const tracker = new WorkerTracker('hands-full', true);
    const loading = tracker.init();
    FakeWorker.last.answer({ type: 'loaded', delegate: 'GPU', faceDelegate: 'GPU' });
    await loading;
    tracker.dispose();
    expect(tracker.delegate).toBe('uninitialized');
    expect(tracker.faceDelegate).toBe('uninitialized');
  });
});

describe('tracking a frame in the worker', () => {
  it('moves the frame to the worker with the page time and the face regions', () => {
    const tracker = new WorkerTracker('hands-full', true);
    const frame = picture();
    const regions: [null, { x: number; y: number; width: number; height: number }] = [
      null,
      { x: 0.6, y: 0.1, width: 0.3, height: 0.5 },
    ];
    void tracker.track(frame, 1234.5, regions);
    const [{ request, transfer }] = FakeWorker.last.posted;
    expect(request).toEqual({ type: 'track', frame: 1, picture: frame, timeMs: 1234.5, faceRegions: regions });
    expect(transfer).toEqual([frame]);
  });

  it('gives each answer to its own frame', async () => {
    const tracker = new WorkerTracker('hands-full', false);
    const first = tracker.track(picture(), 100);
    const second = tracker.track(picture(), 133);
    FakeWorker.last.answer({ type: 'tracked', frame: 2, result: result(133) });
    FakeWorker.last.answer({ type: 'tracked', frame: 1, result: result(100) });
    expect((await first).timeMs).toBe(100);
    expect((await second).timeMs).toBe(133);
  });

  it('rejects a frame with the failure inside the tracker', async () => {
    const tracker = new WorkerTracker('hands-full', false);
    const tracking = tracker.track(picture(), 100);
    FakeWorker.last.answer({ type: 'trackFailed', frame: 1, error: 'Tracker is not ready.' });
    await expect(tracking).rejects.toThrow('Tracker is not ready.');
  });

  it('fails the frame that is out when the tracker is disposed', async () => {
    const tracker = new WorkerTracker('hands-full', false);
    const tracking = tracker.track(picture(), 100);
    tracker.dispose();
    await expect(tracking).rejects.toThrow('Tracker is disposed.');
  });
});

describe('a worker that breaks', () => {
  it('fails the frame that is out and every later request', async () => {
    const tracker = new WorkerTracker('hands-full', false);
    const tracking = tracker.track(picture(), 100);
    FakeWorker.last.breakDown('out of memory');
    await expect(tracking).rejects.toThrow('The tracking worker failed: out of memory');

    const unsent = picture();
    await expect(tracker.track(unsent, 133)).rejects.toThrow('out of memory');
    expect(unsent.close).toHaveBeenCalled();
    await expect(tracker.init()).rejects.toThrow('out of memory');
  });

  it('says it did not start when the browser gives no reason', async () => {
    const tracker = new WorkerTracker('hands-full', false);
    const loading = tracker.init();
    FakeWorker.last.breakDown('');
    await expect(loading).rejects.toThrow('The tracking worker failed: it did not start.');
  });
});

describe('the limits of a worker', () => {
  it('ends a worker whose load passes the load limit, and fails the load', async () => {
    vi.useFakeTimers();
    const tracker = new WorkerTracker('hands-split', true);
    const loading = tracker.init();
    vi.advanceTimersByTime(WORKER_LIMITS.loadMs);
    await expect(loading).rejects.toThrow(`did not load its tracker within ${WORKER_LIMITS.loadMs / 1000} s`);
    expect(FakeWorker.last.terminated).toBe(true);
    expect(tracker.broken).toBe(true);
  });

  it('ends a worker that holds a frame past the frame limit, and fails every later frame', async () => {
    vi.useFakeTimers();
    const tracker = new WorkerTracker('hands-full', false);
    const tracking = tracker.track(picture(), 100);
    vi.advanceTimersByTime(WORKER_LIMITS.frameMs);
    await expect(tracking).rejects.toThrow(`did not answer a camera frame within ${WORKER_LIMITS.frameMs / 1000} s`);
    expect(FakeWorker.last.terminated).toBe(true);
    await expect(tracker.track(picture(), 133)).rejects.toThrow('did not answer a camera frame');
  });

  it('leaves a worker alone that answers in time', async () => {
    vi.useFakeTimers();
    const tracker = new WorkerTracker('hands-full', false);
    const tracking = tracker.track(picture(), 100);
    FakeWorker.last.answer({ type: 'tracked', frame: 1, result: result(100) });
    await tracking;
    vi.advanceTimersByTime(WORKER_LIMITS.frameMs * 2);
    expect(FakeWorker.last.terminated).toBe(false);
    expect(tracker.broken).toBe(false);
  });

  it('reads as broken, with uninitialized delegates, once its worker failed', async () => {
    const tracker = new WorkerTracker('hands-full', false);
    const loading = tracker.init();
    FakeWorker.last.answer({ type: 'loaded', delegate: 'GPU', faceDelegate: 'uninitialized' });
    await loading;
    FakeWorker.last.breakDown('lost');
    expect(tracker.broken).toBe(true);
    expect(tracker.delegate).toBe('uninitialized');
    expect(FakeWorker.last.terminated).toBe(true);
  });
});
