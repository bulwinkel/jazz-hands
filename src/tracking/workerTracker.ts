import { WORKER_LIMITS } from './config';
import type { FaceRegions, TrackerDelegate, TrackerMode, TrackingFrame } from './types';
import type { LoadedTracker, WorkerAnswer, WorkerRequest } from './workerProtocol';

const DISPOSED = 'Tracker is disposed.';

/** A request that waits for its answer, and the timer that gives up on it. */
interface Waiting<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * A tracker in a tracking worker of its own, as the page sees it. It has the life of a tracker
 * on the page: `init` loads it once, `dispose` frees it, and its delegates read
 * 'uninitialized' until it has loaded and after it is disposed.
 *
 * Why one worker per tracker: Chrome keeps at most 4 active WebGL contexts in a worker, and
 * beyond that it drops the one used least recently. Each GPU model has a context of its own,
 * and split hands with face models need 4. A worker of its own keeps every tracker within the
 * limit, and ending the worker frees its contexts at once.
 *
 * It sends every frame it is given: which frames go is the caller's choice (see
 * `FrameHandOver`). When the worker breaks, or passes a limit of `WORKER_LIMITS`, the page ends
 * it: every request that waits fails, every later request fails, and the delegates read
 * 'uninitialized' again.
 */
export class WorkerTracker {
  readonly mode: TrackerMode;
  private readonly faces: boolean;
  private readonly worker: Worker;
  private load?: Waiting<LoadedTracker>;
  private loading?: Promise<void>;
  private loaded?: LoadedTracker;
  private readonly frames = new Map<number, Waiting<TrackingFrame>>();
  private frameCount = 0;
  /** Why the worker was ended. Every request after that fails with it. */
  private ended?: Error;

  /** Starts the worker. Throws when this browser cannot make one. */
  constructor(mode: TrackerMode, faces: boolean) {
    this.mode = mode;
    this.faces = faces;
    // A module worker, in `npm run dev` and in a build alike. `visionRuntime` relies on that.
    this.worker = new Worker(new URL('./trackingWorker.ts', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', (event: MessageEvent<WorkerAnswer>) => this.onAnswer(event.data));
    this.worker.addEventListener('error', (event: ErrorEvent) => {
      // Handled here: without this, the page would also report the error as uncaught.
      event.preventDefault();
      this.end(new Error(`A tracking worker failed: ${event.message || 'it did not start.'}`));
    });
    this.worker.addEventListener('messageerror', () => {
      this.end(new Error('A tracking worker sent a message the page cannot read.'));
    });
  }

  get delegate(): TrackerDelegate {
    return this.loaded?.delegate ?? 'uninitialized';
  }

  /** True once the worker was ended: by a failure, a limit, or a dispose. */
  get broken(): boolean {
    return this.ended !== undefined;
  }

  /** What the face models run on. 'uninitialized' for a tracker created without faces. */
  get faceDelegate(): TrackerDelegate {
    return this.loaded?.faceDelegate ?? 'uninitialized';
  }

  /** Loads the tracker in the worker. Repeated calls share one load. */
  init(): Promise<void> {
    this.loading ??= this.loadInWorker();
    return this.loading;
  }

  /** Tracks one camera frame. `picture` moves to the worker, which closes it. */
  track(picture: VideoFrame, timeMs: number, faceRegions?: FaceRegions): Promise<TrackingFrame> {
    if (this.ended) {
      picture.close();
      return Promise.reject(this.ended);
    }
    this.frameCount++;
    const frame = this.frameCount;
    return new Promise((resolve, reject) => {
      const timer = this.giveUpAfter(WORKER_LIMITS.frameMs, 'answer a camera frame');
      this.frames.set(frame, { resolve, reject, timer });
      try {
        this.post({ type: 'track', frame, picture, timeMs, faceRegions }, [picture]);
      } catch (error) {
        // The frame never reached the worker, so it is still the page's to close.
        clearTimeout(timer);
        this.frames.delete(frame);
        picture.close();
        reject(error);
      }
    });
  }

  /** Ends the worker. Its models and their WebGL contexts go at once. What still waits fails as disposed. */
  dispose(): void {
    this.end(new Error(DISPOSED));
  }

  private async loadInWorker(): Promise<void> {
    if (this.ended) throw this.ended;
    const loaded = await new Promise<LoadedTracker>((resolve, reject) => {
      this.load = { resolve, reject, timer: this.giveUpAfter(WORKER_LIMITS.loadMs, 'load its tracker') };
      this.post({ type: 'load', mode: this.mode, faces: this.faces });
    });
    // The tracker can be disposed between the answer and this line.
    if (this.ended) throw this.ended;
    this.loaded = loaded;
  }

  private post(request: WorkerRequest, transfer: Transferable[] = []): void {
    this.worker.postMessage(request, transfer);
  }

  private onAnswer(answer: WorkerAnswer): void {
    if (answer.type === 'loaded' || answer.type === 'loadFailed') {
      const waiting = this.load;
      this.load = undefined;
      if (waiting) clearTimeout(waiting.timer);
      if (answer.type === 'loaded') waiting?.resolve({ delegate: answer.delegate, faceDelegate: answer.faceDelegate });
      else waiting?.reject(new Error(answer.error));
      return;
    }
    const waiting = this.frames.get(answer.frame);
    this.frames.delete(answer.frame);
    if (waiting) clearTimeout(waiting.timer);
    if (answer.type === 'tracked') waiting?.resolve(answer.result);
    else waiting?.reject(new Error(answer.error));
  }

  /** A timer that ends the worker when a request waits longer than `limitMs`. */
  private giveUpAfter(limitMs: number, task: string): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      this.end(new Error(`A tracking worker did not ${task} within ${limitMs / 1000} s.`));
    }, limitMs);
  }

  /**
   * Ends the worker: what waits fails with `error`, and so does every later request. The
   * delegates read 'uninitialized' again, so the tracker switch loads this mode anew.
   */
  private end(error: Error): void {
    this.ended ??= error;
    this.loaded = undefined;
    const waiting = [...(this.load ? [this.load] : []), ...this.frames.values()];
    this.load = undefined;
    this.frames.clear();
    for (const request of waiting) {
      clearTimeout(request.timer);
      request.reject(this.ended);
    }
    this.worker.terminate();
  }
}
