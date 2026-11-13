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
   * this happens at once, and a failure throws. From the worker the result comes later, and a
   * failure goes to `onError`. A frame that comes while the worker is busy waits until the
   * worker answers, unless a newer frame takes its place (see `FrameHandOver`).
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

/** A camera frame offered to the worker: what it takes to send the frame now or a moment later. */
interface CameraOffer {
  video: HTMLVideoElement;
  /** The page's time when the frame came. It stays the frame's time, also when the frame goes later. */
  timeMs: number;
  faceRegions: () => FaceRegions;
  onFrame: (frame: TrackingFrame) => void;
  onError: (error: unknown) => void;
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
  private readonly handOver = new FrameHandOver<WorkerTracker, CameraOffer>();

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
    // The frame's time is the page's: the worker's clock has another origin.
    this.send({ video, timeMs: performance.now(), faceRegions, onFrame, onError });
  }

  dispose(): void {
    this.handOver.close();
    this.trackers.dispose();
  }

  /** Sends a camera frame to the tracker in use. While the worker is busy, the hand-over holds it. */
  private send(offer: CameraOffer): void {
    const tracker = this.trackers.current;
    const number = this.handOver.offer(tracker, offer);
    if (number === null) return;
    try {
      const regions = offer.faceRegions();
      // The video still shows the offered frame: the frame after it would have been offered in its place.
      const picture = new VideoFrame(offer.video);
      tracker.track(picture, offer.timeMs, regions).then(
        (frame) => this.answer(number, offer, () => offer.onFrame({ ...frame, timeMs: offer.timeMs })),
        (error: unknown) => this.answer(number, offer, () => offer.onError(error)),
      );
    } catch (error) {
      this.handOver.settle(number, tracker);
      throw error;
    }
  }

  /**
   * Passes an answer of the worker on, when it still counts, and sends the frame that came
   * meanwhile. An error in the game's handling of a frame stops tracking, as on the main thread.
   */
  private answer(number: number, offer: CameraOffer, pass: () => void): void {
    const { counts, next } = this.handOver.settle(number, this.trackers.current);
    if (counts) {
      try {
        pass();
      } catch (error) {
        offer.onError(error);
      }
    }
    if (!next) return;
    try {
      this.send(next);
    } catch (error) {
      next.onError(error);
    }
  }
}
