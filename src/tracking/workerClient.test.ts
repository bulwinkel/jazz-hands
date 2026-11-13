import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackingFrame } from './types';
import { TrackingWorker } from './workerClient';
import type { WorkerAnswer, WorkerRequest } from './workerProtocol';

type Listener = (event: { data?: WorkerAnswer; message?: string; preventDefault?: () => void }) => void;

/** A stand-in for the browser's Worker. The test answers for the worker by hand. */
class FakeWorker {
  static last: FakeWorker;
  readonly options: WorkerOptions;
  readonly posted: { request: WorkerRequest; transfer: Transferable[] }[] = [];
  private readonly listeners = new Map<string, Listener[]>();
  terminated = false;

  constructor(_url: URL, options: WorkerOptions) {
    this.options = options;
    FakeWorker.last = this;
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

  lastRequest(): WorkerRequest {
    return this.posted[this.posted.length - 1].request;
  }
}

const picture = (): VideoFrame => ({ close: vi.fn() }) as unknown as VideoFrame;
const result = (timeMs: number): TrackingFrame => ({ timeMs, inferenceMs: 12, players: [{ hands: [] }, { hands: [] }] });

beforeEach(() => vi.stubGlobal('Worker', FakeWorker));
afterEach(() => vi.unstubAllGlobals());

describe('the tracking worker', () => {
  it('starts as a module worker, as the WASM loader needs', () => {
    new TrackingWorker();
    expect(FakeWorker.last.options.type).toBe('module');
  });
});

describe('loading a tracker in the worker', () => {
  it('reads the delegates the worker reports once the tracker has loaded', async () => {
    const tracker = new TrackingWorker().tracker('hands-split', true);
    const loading = tracker.init();
    expect(tracker.delegate).toBe('uninitialized');
    expect(FakeWorker.last.lastRequest()).toEqual({ type: 'load', tracker: 1, mode: 'hands-split', faces: true });

    FakeWorker.last.answer({ type: 'loaded', tracker: 1, delegate: 'GPU', faceDelegate: 'GPU' });
    await loading;
    expect(tracker.delegate).toBe('GPU');
    expect(tracker.faceDelegate).toBe('GPU');
  });

  it('loads once, however often init is called', () => {
    const tracker = new TrackingWorker().tracker('hands-full', false);
    expect(tracker.init()).toBe(tracker.init());
    expect(FakeWorker.last.posted).toHaveLength(1);
  });

  it('rejects with the reason the worker gives', async () => {
    const tracker = new TrackingWorker().tracker('pose', false);
    const loading = tracker.init();
    FakeWorker.last.answer({ type: 'loadFailed', tracker: 1, error: 'No model file.' });
    await expect(loading).rejects.toThrow('No model file.');
  });

  it('rejects a load that ends after the tracker was disposed, and frees it in the worker', async () => {
    const tracker = new TrackingWorker().tracker('hands-full', false);
    const loading = tracker.init();
    tracker.dispose();
    expect(FakeWorker.last.lastRequest()).toEqual({ type: 'dispose', tracker: 1 });
    FakeWorker.last.answer({ type: 'loaded', tracker: 1, delegate: 'GPU', faceDelegate: 'uninitialized' });
    await expect(loading).rejects.toThrow('Tracker is disposed.');
    expect(tracker.delegate).toBe('uninitialized');
    await expect(tracker.init()).rejects.toThrow('Tracker is disposed.');
  });
});

describe('tracking a frame in the worker', () => {
  it('moves the frame to the worker with the page time and the face regions', () => {
    const tracker = new TrackingWorker().tracker('hands-full', true);
    const frame = picture();
    const regions = [null, { x: 0.6, y: 0.1, width: 0.3, height: 0.5 }] as const;
    void tracker.track(frame, 1234.5, [...regions]);
    const [{ request, transfer }] = FakeWorker.last.posted;
    expect(request).toEqual({
      type: 'track', tracker: 1, frame: 1, picture: frame, timeMs: 1234.5, faceRegions: [...regions],
    });
    expect(transfer).toEqual([frame]);
  });

  it('gives each answer to its own frame', async () => {
    const worker = new TrackingWorker();
    const tracker = worker.tracker('hands-full', false);
    const first = tracker.track(picture(), 100);
    const second = tracker.track(picture(), 133);
    FakeWorker.last.answer({ type: 'tracked', frame: 2, result: result(133) });
    FakeWorker.last.answer({ type: 'tracked', frame: 1, result: result(100) });
    expect((await first).timeMs).toBe(100);
    expect((await second).timeMs).toBe(133);
  });

  it('rejects a frame with the failure inside the tracker', async () => {
    const tracker = new TrackingWorker().tracker('hands-full', false);
    const tracking = tracker.track(picture(), 100);
    FakeWorker.last.answer({ type: 'trackFailed', frame: 1, error: 'Tracker is not ready.' });
    await expect(tracking).rejects.toThrow('Tracker is not ready.');
  });
});

describe('a worker that breaks', () => {
  it('fails the frame that is out and every later request', async () => {
    const tracker = new TrackingWorker().tracker('hands-full', false);
    const tracking = tracker.track(picture(), 100);
    FakeWorker.last.breakDown('out of memory');
    await expect(tracking).rejects.toThrow('The tracking worker failed: out of memory');

    const unsent = picture();
    await expect(tracker.track(unsent, 133)).rejects.toThrow('out of memory');
    expect(unsent.close).toHaveBeenCalled();
    await expect(tracker.init()).rejects.toThrow('out of memory');
  });

  it('says it did not start when the browser gives no reason', async () => {
    const tracker = new TrackingWorker().tracker('hands-full', false);
    const loading = tracker.init();
    FakeWorker.last.breakDown('');
    await expect(loading).rejects.toThrow('The tracking worker failed: it did not start.');
  });
});

describe('ending the worker', () => {
  it('ends the browser worker and fails what still waits as disposed', async () => {
    const worker = new TrackingWorker();
    const loading = worker.tracker('hands-split', false).init();
    const tracking = worker.tracker('hands-full', false).track(picture(), 100);
    worker.terminate();
    expect(FakeWorker.last.terminated).toBe(true);
    await expect(loading).rejects.toThrow('Tracker is disposed.');
    await expect(tracking).rejects.toThrow('Tracker is disposed.');
  });
});
