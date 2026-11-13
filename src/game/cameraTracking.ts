import { createTracker } from '../tracking';
import { FrameHandOver } from '../tracking/handOver';
import type {
  FaceRegions,
  Tracker,
  TrackerDelegate,
  TrackerMode,
  TrackingFrame,
  TrackingThread,
} from '../tracking/types';
import { WorkerTracker } from '../tracking/workerTracker';
import { TrackerSwitch } from './trackerSwitch';

/** The names of the tracker in use, for the debug overlay and the run report. */
export interface TrackerNames {
  readonly mode: TrackerMode;
  readonly delegate: TrackerDelegate;
  readonly faceDelegate: TrackerDelegate;
}

/** The trackers of a camera input, on one thread, and how a camera frame reaches the one in use. */
export interface CameraTracking {
  readonly thread: TrackingThread;
  readonly current: TrackerNames;
  /** Loads the first tracker. */
  init(): Promise<void>;
  /** See `TrackerSwitch.setMode`. */
  setMode(mode: TrackerMode, faces: boolean): Promise<void>;
  /**
   * Tracks the video's current frame and gives the result to `onFrame`. On the main thread
   * this happens at once, and a failure throws. From the worker the result comes later, a
   * failure goes to `onError`, and a frame that comes while the worker is busy is dropped.
   * `faceRegions` is read only for a frame that is tracked.
   */
  track(
    video: HTMLVideoElement,
    faceRegions: () => FaceRegions,
    onFrame: (frame: TrackingFrame) => void,
    onError: (error: unknown) => void,
  ): void;
  dispose(): void;
}

/**
 * The trackers for a camera input. With `worker` they run in the tracking worker, unless this
 * browser cannot make one: then they run on the main thread.
 */
export function cameraTracking(mode: TrackerMode, faces: boolean, thread: TrackingThread): CameraTracking {
  if (thread === 'worker' && canTrackInWorker()) {
    try {
      return new WorkerTracking(mode, faces);
    } catch (error) {
      console.warn('Cannot make the tracking worker. Tracking runs on the main thread.', error);
    }
  }
  return new PageTracking(mode, faces);
}

/** The worker gets VideoFrames, and its trackers need an OffscreenCanvas. */
function canTrackInWorker(): boolean {
  return typeof Worker === 'function' && typeof VideoFrame === 'function' && typeof OffscreenCanvas === 'function';
}

/** Trackers on the page's main thread. Inference blocks the page while it runs. */
export class PageTracking implements CameraTracking {
  readonly thread = 'main';
  private readonly trackers: TrackerSwitch<Tracker>;

  constructor(mode: TrackerMode, faces: boolean) {
    this.trackers = new TrackerSwitch((nextMode, withFaces) => createTracker(nextMode, { faces: withFaces }), mode, faces);
  }

  get current(): TrackerNames {
    return this.trackers.current;
  }

  init(): Promise<void> {
    return this.trackers.current.init();
  }

  setMode(mode: TrackerMode, faces: boolean): Promise<void> {
    return this.trackers.setMode(mode, faces);
  }

  track(video: HTMLVideoElement, faceRegions: () => FaceRegions, onFrame: (frame: TrackingFrame) => void): void {
    onFrame(this.trackers.current.process(video, performance.now(), faceRegions()));
  }

  dispose(): void {
    this.trackers.dispose();
  }
}

/**
 * Trackers in tracking workers, one worker per tracker. Each camera frame goes to the worker of
 * the tracker in use as a VideoFrame, which costs the page a fraction of a millisecond, and the
 * page draws on while the worker tracks.
 */
export class WorkerTracking implements CameraTracking {
  readonly thread = 'worker';
  private readonly trackers: TrackerSwitch<WorkerTracker>;
  /** One rule for every tracker: at most one frame is out, whichever worker it is in. */
  private readonly handOver = new FrameHandOver<WorkerTracker>();

  /** Throws when this browser cannot make the worker. */
  constructor(mode: TrackerMode, faces: boolean) {
    this.trackers = new TrackerSwitch((nextMode, withFaces) => new WorkerTracker(nextMode, withFaces), mode, faces);
  }

  get current(): TrackerNames {
    return this.trackers.current;
  }

  init(): Promise<void> {
    return this.trackers.current.init();
  }

  setMode(mode: TrackerMode, faces: boolean): Promise<void> {
    return this.trackers.setMode(mode, faces);
  }

  track(
    video: HTMLVideoElement,
    faceRegions: () => FaceRegions,
    onFrame: (frame: TrackingFrame) => void,
    onError: (error: unknown) => void,
  ): void {
    const tracker = this.trackers.current;
    const number = this.handOver.send(tracker);
    if (number === null) return; // The worker is busy: this camera frame is dropped.
    // The frame's time is the page's: the worker's clock has another origin.
    const timeMs = performance.now();
    try {
      const regions = faceRegions();
      const picture = new VideoFrame(video);
      tracker.track(picture, timeMs, regions).then(
        (frame) => this.answer(number, onError, () => onFrame({ ...frame, timeMs })),
        (error: unknown) => this.answer(number, onError, () => onError(error)),
      );
    } catch (error) {
      this.handOver.settle(number, tracker);
      throw error;
    }
  }

  dispose(): void {
    this.handOver.close();
    this.trackers.dispose();
  }

  /**
   * Passes an answer of the worker on, when it still counts. An error in the game's handling
   * of a frame stops tracking, the same as on the main thread.
   */
  private answer(number: number, onError: (error: unknown) => void, pass: () => void): void {
    if (!this.handOver.settle(number, this.trackers.current)) return;
    try {
      pass();
    } catch (error) {
      onError(error);
    }
  }
}
