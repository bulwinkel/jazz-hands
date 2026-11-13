import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackingFrame } from './types';
import { WorkerTracker } from './workerTracker';
import type { WorkerAnswer, WorkerRequest } from './workerProtocol';

type Listener = (event: { data?: WorkerAnswer; message?: string; preventDefault?: () => void }) => void;

/** A stand-in for the browser's Worker. The test answers for the worker by hand. */
class FakeWorker {
  static made: FakeWorker[] = [];
  readonly options: WorkerOptions;
  readonly posted: { request: WorkerRequest; transfer: Transferable[] }[] = [];
  private readonly listeners = new Map<string, Listener[]>();
  terminated = false;

  constructor(_url: URL, options: WorkerOptions) {
    this.options = options;
    FakeWorker.made.push(this);
  }

  static get last(): FakeWorker {
    return FakeWorker.made[FakeWorker.made.length - 1];
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  postMessage(request: WorkerRequest, transfer: Transferable[] = []): void {
    this.posted.push({ request, transfer });
  }

  terminate(): void {
    this.terminated = true;
  }

  answer(answer: WorkerAnswer): void {
    for (const listener of this.listeners.get('message') ?? []) listener({ data: answer });
  }

  breakDown(message: string): void {
    for (const listener of this.listeners.get('error') ?? []) listener({ message, preventDefault: () => {} });
  }
}

const picture = (): VideoFrame => ({ close: vi.fn() }) as unknown as VideoFrame;
const result = (timeMs: number): TrackingFrame => ({ timeMs, inferenceMs: 12, players: [{ hands: [] }, { hands: [] }] });

beforeEach(() => {
  FakeWorker.made = [];
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => vi.unstubAllGlobals());

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
