import type { FaceRegions, TrackerDelegate, TrackerMode, TrackingFrame } from './types';
import type { LoadedTracker, WorkerAnswer, WorkerRequest } from './workerProtocol';

const DISPOSED = 'Tracker is disposed.';

/** A request that waits for its answer. */
interface Waiting<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

/**
 * The page's side of the tracking worker. It starts the worker, sends it requests, and gives
 * each answer to the request it belongs to. It sends every frame it is given: which frames
 * go is the caller's choice (see `FrameHandOver`).
 *
 * When the worker breaks, every request that waits fails, and so does every later request.
 */
export class TrackingWorker {
  private readonly worker: Worker;
  private readonly loads = new Map<number, Waiting<LoadedTracker>>();
  private readonly frames = new Map<number, Waiting<TrackingFrame>>();
  private trackerCount = 0;
  private frameCount = 0;
  /** Set when the worker broke or was ended. Every request after that fails with it. */
  private broken?: Error;

  /** Throws when this browser cannot make the worker. */
  constructor() {
    // A module worker, in `npm run dev` and in a build alike. `visionRuntime` relies on that.
    this.worker = new Worker(new URL('./trackingWorker.ts', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', (event: MessageEvent<WorkerAnswer>) => this.onAnswer(event.data));
    this.worker.addEventListener('error', (event: ErrorEvent) => {
      // Handled here: without this, the page would also report the error as uncaught.
      event.preventDefault();
      this.breakDown(new Error(`The tracking worker failed: ${event.message || 'it did not start.'}`));
    });
    this.worker.addEventListener('messageerror', () => {
      this.breakDown(new Error('The tracking worker sent a message the page cannot read.'));
    });
  }

  /** A new tracker in the worker. It loads when its `init` is called. */
  tracker(mode: TrackerMode, faces: boolean): WorkerTracker {
    this.trackerCount++;
    return new WorkerTracker(this, this.trackerCount, mode, faces);
  }

  load(tracker: number, mode: TrackerMode, faces: boolean): Promise<LoadedTracker> {
    return this.ask(this.loads, tracker, { type: 'load', tracker, mode, faces });
  }

  /** Tracks one camera frame. `picture` moves to the worker, which closes it. */
  track(tracker: number, picture: VideoFrame, timeMs: number, faceRegions?: FaceRegions): Promise<TrackingFrame> {
    this.frameCount++;
    const request: WorkerRequest = { type: 'track', tracker, frame: this.frameCount, picture, timeMs, faceRegions };
    return this.ask(this.frames, this.frameCount, request, [picture]).catch((error: unknown) => {
      // A frame that never reached the worker is still the page's to close. Closing twice does no harm.
      picture.close();
      throw error;
    });
  }

  /** Lets the worker close a tracker and free its models. */
  release(tracker: number): void {
    if (!this.broken) this.worker.postMessage({ type: 'dispose', tracker } satisfies WorkerRequest);
  }

  /** Ends the worker and every tracker in it. Requests that still wait fail as disposed. */
  terminate(): void {
    this.breakDown(new Error(DISPOSED));
    this.worker.terminate();
  }

  private ask<T>(
    waiting: Map<number, Waiting<T>>,
    id: number,
    request: WorkerRequest,
    transfer: Transferable[] = [],
  ): Promise<T> {
    if (this.broken) return Promise.reject(this.broken);
    return new Promise<T>((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      try {
        this.worker.postMessage(request, transfer);
      } catch (error) {
        waiting.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private onAnswer(answer: WorkerAnswer): void {
    if (answer.type === 'loaded' || answer.type === 'loadFailed') {
      const waiting = this.loads.get(answer.tracker);
      this.loads.delete(answer.tracker);
      if (answer.type === 'loaded') waiting?.resolve({ delegate: answer.delegate, faceDelegate: answer.faceDelegate });
      else waiting?.reject(new Error(answer.error));
      return;
    }
    const waiting = this.frames.get(answer.frame);
    this.frames.delete(answer.frame);
    if (answer.type === 'tracked') waiting?.resolve(answer.result);
    else waiting?.reject(new Error(answer.error));
  }

  private breakDown(error: Error): void {
    this.broken ??= error;
    for (const waiting of [...this.loads.values(), ...this.frames.values()]) waiting.reject(this.broken);
    this.loads.clear();
    this.frames.clear();
  }
}

/**
 * A tracker in the tracking worker, as the page sees it. It has the life of a page tracker:
 * `init` loads it once, `dispose` frees it, and its delegates read 'uninitialized' until it
 * has loaded and after it is disposed.
 */
export class WorkerTracker {
  readonly mode: TrackerMode;
  private readonly worker: TrackingWorker;
  private readonly id: number;
  private readonly faces: boolean;
  private loaded?: LoadedTracker;
  private loading?: Promise<void>;
  private disposed = false;

  constructor(worker: TrackingWorker, id: number, mode: TrackerMode, faces: boolean) {
    this.worker = worker;
    this.id = id;
    this.mode = mode;
    this.faces = faces;
  }

  get delegate(): TrackerDelegate {
    return this.loaded?.delegate ?? 'uninitialized';
  }

  /** What the face models run on. 'uninitialized' for a tracker created without faces. */
  get faceDelegate(): TrackerDelegate {
    return this.loaded?.faceDelegate ?? 'uninitialized';
  }

  /** Loads the tracker in the worker. Repeated calls share one load. */
  init(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error(DISPOSED));
    this.loading ??= this.load();
    return this.loading;
  }

  track(picture: VideoFrame, timeMs: number, faceRegions?: FaceRegions): Promise<TrackingFrame> {
    return this.worker.track(this.id, picture, timeMs, faceRegions);
  }

  dispose(): void {
    this.disposed = true;
    this.loaded = undefined;
    this.worker.release(this.id);
  }

  private async load(): Promise<void> {
    const loaded = await this.worker.load(this.id, this.mode, this.faces);
    if (this.disposed) throw new Error(DISPOSED);
    this.loaded = loaded;
  }
}
