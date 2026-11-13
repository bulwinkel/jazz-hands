import type { FaceRegions, TrackerDelegate, TrackerMode, TrackingFrame } from './types';
import type { LoadedTracker, WorkerAnswer, WorkerRequest } from './workerProtocol';

const DISPOSED = 'Tracker is disposed.';

/** A request that waits for its answer. */
interface Waiting<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
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
 * `FrameHandOver`). When the worker breaks, every request that waits fails, and so does every
 * later request.
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
  /** Set when the worker broke or was ended. Every request after that fails with it. */
  private broken?: Error;

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
      this.breakDown(new Error(`The tracking worker failed: ${event.message || 'it did not start.'}`));
    });
    this.worker.addEventListener('messageerror', () => {
      this.breakDown(new Error('The tracking worker sent a message the page cannot read.'));
    });
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
    this.loading ??= this.loadInWorker();
    return this.loading;
  }

  /** Tracks one camera frame. `picture` moves to the worker, which closes it. */
  track(picture: VideoFrame, timeMs: number, faceRegions?: FaceRegions): Promise<TrackingFrame> {
    if (this.broken) {
      picture.close();
      return Promise.reject(this.broken);
    }
    this.frameCount++;
    const frame = this.frameCount;
    return new Promise((resolve, reject) => {
      this.frames.set(frame, { resolve, reject });
      try {
        this.post({ type: 'track', frame, picture, timeMs, faceRegions }, [picture]);
      } catch (error) {
        // The frame never reached the worker, so it is still the page's to close.
        this.frames.delete(frame);
        picture.close();
        reject(error);
      }
    });
  }

  /** Ends the worker. Its models and their WebGL contexts go at once. What still waits fails as disposed. */
  dispose(): void {
    this.loaded = undefined;
    this.breakDown(new Error(DISPOSED));
    this.worker.terminate();
  }

  private async loadInWorker(): Promise<void> {
    if (this.broken) throw this.broken;
    const loaded = await new Promise<LoadedTracker>((resolve, reject) => {
      this.load = { resolve, reject };
      this.post({ type: 'load', mode: this.mode, faces: this.faces });
    });
    // The tracker can be disposed between the answer and this line.
    if (this.broken) throw this.broken;
    this.loaded = loaded;
  }

  private post(request: WorkerRequest, transfer: Transferable[] = []): void {
    this.worker.postMessage(request, transfer);
  }

  private onAnswer(answer: WorkerAnswer): void {
    if (answer.type === 'loaded' || answer.type === 'loadFailed') {
      const waiting = this.load;
      this.load = undefined;
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
    this.load?.reject(this.broken);
    this.load = undefined;
    for (const waiting of this.frames.values()) waiting.reject(this.broken);
    this.frames.clear();
  }
}
