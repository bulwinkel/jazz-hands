import { FrameHandOver } from './handOver';
// From the index, so that a test of the camera input can stand in for the trackers there.
import { createTracker } from './index';
import { TrackerSwitch } from './trackerSwitch';
import type {
  FaceRegions,
  Tracker,
  TrackerDelegate,
  TrackerMode,
  TrackingFrame,
  TrackingThread,
} from './types';
import { WorkerTracker } from './workerTracker';

/** The names of the tracker in use, for the debug overlay and the run report. */
export interface TrackerNames {
  readonly mode: TrackerMode;
  readonly delegate: TrackerDelegate;
  readonly faceDelegate: TrackerDelegate;
  readonly thread: TrackingThread;
}

/** What runs a camera tracker: a tracker on the main thread, or one in a tracking worker of its own. */
type Runner = { thread: 'main'; tracker: Tracker } | { thread: 'worker'; tracker: WorkerTracker };

/**
 * One tracker of the camera input. With the tracking workers asked for, it runs in a worker of
 * its own. When that worker cannot be made, or its tracker does not load there, it loads on
 * the main thread instead. This is the one place of that fallback: for the first tracker and
 * for every later one alike.
 */
export class CameraTracker {
  readonly mode: TrackerMode;
  private readonly faces: boolean;
  private runner: Runner;
  private loading?: Promise<void>;
  private disposed = false;

  constructor(mode: TrackerMode, faces: boolean, thread: TrackingThread) {
    this.mode = mode;
    this.faces = faces;
    this.runner = thread === 'worker' ? inWorkerIfPossible(mode, faces) : onMainThread(mode, faces);
  }

  get thread(): TrackingThread {
    return this.runner.thread;
  }

  get delegate(): TrackerDelegate {
    return this.runner.tracker.delegate;
  }

  get faceDelegate(): TrackerDelegate {
    return this.runner.tracker.faceDelegate;
  }

  /** True once its worker was ended. A tracker on the main thread does not break. */
  get broken(): boolean {
    return this.runner.thread === 'worker' && this.runner.tracker.broken;
  }

  /** What runs the tracker now, for the camera frames to go to. */
  get runs(): Runner {
    return this.runner;
  }

  /** Loads the tracker. Repeated calls share one load. */
  init(): Promise<void> {
    this.loading ??= this.load();
    return this.loading;
  }

  dispose(): void {
    this.disposed = true;
    this.runner.tracker.dispose();
  }

  private async load(): Promise<void> {
    const { runner } = this;
    if (runner.thread === 'worker') {
      try {
        await runner.tracker.init();
        return;
      } catch (error) {
        if (this.disposed) throw error;
        console.warn(`A tracking worker could not load ${this.mode}. It loads on the main thread.`, error);
        runner.tracker.dispose();
        this.runner = onMainThread(this.mode, this.faces);
      }
    }
    await this.runner.tracker.init();
  }
}

function onMainThread(mode: TrackerMode, faces: boolean): Runner {
  return { thread: 'main', tracker: createTracker(mode, { faces }) };
}

/** A tracker in a worker of its own, or on the main thread when this browser cannot make the worker. */
function inWorkerIfPossible(mode: TrackerMode, faces: boolean): Runner {
  // The worker gets VideoFrames, and its trackers need an OffscreenCanvas.
  const canTrackInWorker =
    typeof Worker === 'function' && typeof VideoFrame === 'function' && typeof OffscreenCanvas === 'function';
  if (canTrackInWorker) {
    try {
      return { thread: 'worker', tracker: new WorkerTracker(mode, faces) };
    } catch (error) {
      console.warn(`Cannot make a tracking worker. ${mode} loads on the main thread.`, error);
    }
  }
  return onMainThread(mode, faces);
}

/** A camera frame offered to a worker: what it takes to send the frame now or a moment later. */
interface CameraOffer {
  /**
   * The camera picture, taken when the frame came. A frame that waits keeps its own picture:
   * by the time it goes, the video can show a newer one.
   */
  picture: VideoFrame;
  /** The page's time when the frame came. The worker gives it back as the frame's time. */
  timeMs: number;
  faceRegions: FaceRegions;
  onFrame: (frame: TrackingFrame) => void;
  onError: (error: unknown) => void;
}

/**
 * The trackers of a camera input, and how a camera frame reaches the one in use. On the main
 * thread a frame is tracked at once. In a tracking worker it goes over as a VideoFrame, which
 * costs the page a fraction of a millisecond, and the page draws on while the worker tracks.
 */
export class CameraTracking {
  private readonly trackers: TrackerSwitch<CameraTracker>;
  /** One rule for every tracker in a worker: at most one frame is out, whichever worker it is in. */
  private readonly handOver = new FrameHandOver<CameraTracker, CameraOffer>();

  /** With `worker`, every tracker runs in a tracking worker of its own where it can. */
  constructor(mode: TrackerMode, faces: boolean, thread: TrackingThread) {
    this.trackers = new TrackerSwitch((nextMode, withFaces) => new CameraTracker(nextMode, withFaces, thread), mode, faces);
  }

  get current(): TrackerNames {
    return this.trackers.current;
  }

  /** Loads the first tracker. */
  init(): Promise<void> {
    return this.trackers.current.init();
  }

  /** See `TrackerSwitch.setMode`. */
  setMode(mode: TrackerMode, faces: boolean): Promise<void> {
    return this.trackers.setMode(mode, faces);
  }

  /**
   * Tracks the video's current frame and gives the result to `onFrame`. On the main thread
   * this happens at once, and a failure throws. From a worker the result comes later, and a
   * failure goes to `onError`. A frame that comes while the worker is busy waits until the
   * worker answers, unless a newer frame takes its place (see `FrameHandOver`).
   */
  track(
    video: HTMLVideoElement,
    faceRegions: FaceRegions,
    onFrame: (frame: TrackingFrame) => void,
    onError: (error: unknown) => void,
  ): void {
    const { runs } = this.trackers.current;
    if (runs.thread === 'main') {
      onFrame(runs.tracker.process(video, performance.now(), faceRegions));
      return;
    }
    // The picture and its time are taken together, now. A worker's clock has another origin,
    // so the time is the page's.
    this.offer({ picture: new VideoFrame(video), timeMs: performance.now(), faceRegions, onFrame, onError });
  }

  /**
   * The page time of the oldest camera frame whose result may still come for the tracker in
   * use: out in its worker, or held. Undefined when there is none, and always on the main
   * thread, where a frame is tracked at once.
   */
  pendingFrameMs(): number | undefined {
    const tracker = this.trackers.current;
    if (tracker.runs.thread !== 'worker') return undefined;
    return this.handOver.oldest(tracker)?.timeMs;
  }

  dispose(): void {
    this.handOver.close()?.picture.close();
    this.trackers.dispose();
  }

  /** Sends a camera frame to the tracker in use. While the worker is busy, the hand-over holds it. */
  private offer(offer: CameraOffer): void {
    const tracker = this.trackers.current;
    const { runs } = tracker;
    if (runs.thread !== 'worker') {
      // A held frame after a switch to the main thread, which tracks each camera frame at once.
      offer.picture.close();
      return;
    }
    const { sendAs, dropped } = this.handOver.offer(tracker, offer);
    dropped?.picture.close();
    if (sendAs === null) return;
    runs.tracker.track(offer.picture, offer.timeMs, offer.faceRegions).then(
      (frame) => this.answer(sendAs, offer, () => offer.onFrame(frame)),
      (error: unknown) => this.answer(sendAs, offer, () => offer.onError(error)),
    );
  }

  /**
   * Sends the frame that came meanwhile, then passes the answer on when it still counts. The
   * held frame goes first, so the worker tracks while the game handles the answer. An error
   * in the game's handling of a frame stops tracking, as on the main thread.
   */
  private answer(number: number, offer: CameraOffer, pass: () => void): void {
    const { counts, next } = this.handOver.settle(number, this.trackers.current);
    if (next) this.offer(next);
    if (!counts) return;
    try {
      pass();
    } catch (error) {
      offer.onError(error);
    }
  }
}
