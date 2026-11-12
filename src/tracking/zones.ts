import { FilesetResolver, GestureRecognizer, HandLandmarker } from '@mediapipe/tasks-vision';
import type { Category } from '@mediapipe/tasks-vision';
import { TRACKING_THRESHOLDS } from './config';
import { cropToFrame, gestureName, handSize, palmCentre } from './geometry';
import { shapeFromLandmarks } from './shapes';
import type { GestureName, Point, TrackedHand, TrackerDelegate } from './types';
import { cropLandmarksToFrame, HANDS_PER_ZONE, handsInZone, MAX_ZONES, zoneCrop } from './zoneGeometry';
import type { PixelRect } from './zoneGeometry';

/**
 * Hand tracking for one to four players who stand side by side, each in a zone of their own.
 *
 * There are two ways to cover the zones, and which is better is a matter of measurement:
 *
 * - `full`: one model looks at the whole frame and is asked for the hands of every player.
 * - `crops`: every zone has a model of its own that looks at a crop of that zone. A crop is
 *   narrower than the frame, so a hand fills more of the picture the model works on.
 *
 * A MediaPipe hand model has two parts. A detector searches the whole picture for hands, and a
 * landmark model follows each hand it found. The detector runs only while the model follows
 * fewer hands than it was asked for. So the hands asked for decide how often the detector runs.
 */

export type ZoneLayout = 'full' | 'crops';

/**
 * `gesture` is MediaPipe's gesture recognizer. `landmarks` is the plain hand landmarker: the
 * same landmarks with no gesture label, so it has less work to do for each hand.
 */
export type ZoneModel = 'gesture' | 'landmarks';

export interface ZoneTrackerOptions {
  /** How many players stand side by side, 1 to 4. */
  zones: number;
  /** One model on the full frame, or one model per zone on a crop of that zone. */
  layout: ZoneLayout;
  model: ZoneModel;
}

/**
 * A tracked hand. `gesture` is always read from the fingers, with either model, because that
 * works at any hand angle.
 */
export interface ZoneHand extends TrackedHand {
  /** What MediaPipe's gesture model called the hand. Only the `gesture` model sets it. */
  modelGesture?: GestureName;
  /** How sure the gesture model was, 0..1. */
  modelGestureScore?: number;
}

export interface ZoneFrame {
  /** `performance.now()` when the processed video frame was taken. */
  timeMs: number;
  /** The time the whole frame took: every model, and the crops. */
  inferenceMs: number;
  /** Hands per zone, at most two each (the largest), in mirrored full-frame coordinates. */
  zones: ZoneHand[][];
  /** `crops` only: the time each zone took, for its crop and its model. */
  zoneInferenceMs?: number[];
}

const WASM_PATH = '/vendor/tasks-vision-wasm';
const MODEL_PATHS: Record<ZoneModel, string> = {
  gesture: '/models/gesture_recognizer.task',
  landmarks: '/models/hand_landmarker.task',
};
const LANDMARKS_PER_HAND = 21;
const DISPOSED = 'The zone tracker is disposed.';

/** What a model found for one hand. Landmarks are fractions of the picture the model was shown. */
interface FoundHand {
  landmarks: readonly Point[];
  modelGesture?: GestureName;
  modelGestureScore?: number;
}

/** A loaded MediaPipe model. Both kinds find the same landmarks, so the tracker treats them alike. */
interface HandModel {
  find(picture: TexImageSource, timeMs: number): FoundHand[];
  close(): void;
}

type VisionRuntime = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;
let visionRuntime: Promise<VisionRuntime> | undefined;

/** The WASM runtime, from this server. Every model shares the one description of where it is. */
function loadVisionRuntime(): Promise<VisionRuntime> {
  visionRuntime ??= FilesetResolver.forVisionTasks(WASM_PATH);
  return visionRuntime;
}

/**
 * Gives the WebGL context of a closed model back to the browser at once.
 *
 * Chrome keeps at most 16 WebGL contexts on a page. When one more is made, it drops the oldest,
 * and the model on that context stops working. A closed model would hold its context until
 * some later garbage collection, so the limit could hit a model that is still in use.
 */
function releaseWebGl(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  context?.getExtension('WEBGL_lose_context')?.loseContext();
}

function bestCategory(categories: readonly Category[] | undefined): Category | undefined {
  return categories?.toSorted((a, b) => b.score - a.score)[0];
}

async function loadHandModel(
  kind: ZoneModel,
  maxHands: number,
  delegate: 'GPU' | 'CPU',
): Promise<HandModel> {
  const runtime = await loadVisionRuntime();
  // Every model gets a canvas of its own, on the CPU too: MediaPipe reads each picture through
  // WebGL, and two models on one canvas disturb each other.
  const canvas = document.createElement('canvas');
  const options = {
    baseOptions: { modelAssetPath: MODEL_PATHS[kind], delegate },
    canvas,
    runningMode: 'VIDEO' as const,
    numHands: maxHands,
    minHandDetectionConfidence: TRACKING_THRESHOLDS.detection,
    minHandPresenceConfidence: TRACKING_THRESHOLDS.presence,
    minTrackingConfidence: TRACKING_THRESHOLDS.tracking,
  };

  try {
    if (kind === 'gesture') {
      const recognizer = await GestureRecognizer.createFromOptions(runtime, options);
      return {
        find(picture, timeMs) {
          const result = recognizer.recognizeForVideo(picture, timeMs);
          return result.landmarks.map((landmarks, hand) => {
            const best = bestCategory(result.gestures[hand]);
            return {
              landmarks,
              modelGesture: gestureName(best?.categoryName),
              modelGestureScore: best?.score ?? 0,
            };
          });
        },
        close() {
          recognizer.close();
          releaseWebGl(canvas);
        },
      };
    }

    const landmarker = await HandLandmarker.createFromOptions(runtime, options);
    return {
      find(picture, timeMs) {
        const result = landmarker.detectForVideo(picture, timeMs);
        return result.landmarks.map((landmarks) => ({ landmarks }));
      },
      close() {
        landmarker.close();
        releaseWebGl(canvas);
      },
    };
  } catch (error) {
    releaseWebGl(canvas);
    throw error;
  }
}

/**
 * Turns what a model found into tracked hands.
 * `toFrame` maps the landmarks of one hand from the model's picture into the mirrored frame.
 */
function trackedHands(
  found: readonly FoundHand[],
  toFrame: (landmarks: readonly Point[]) => Point[],
  frameAspect: number,
): ZoneHand[] {
  const wholeHands = found.filter((hand) => hand.landmarks.length >= LANDMARKS_PER_HAND);
  return wholeHands.map((hand) => {
    const landmarks = toFrame(hand.landmarks);
    const shape = shapeFromLandmarks(landmarks, frameAspect);
    const tracked: ZoneHand = {
      ...palmCentre(landmarks),
      size: handSize(landmarks, frameAspect),
      gesture: shape ?? 'none',
      gestureScore: shape ? 1 : 0,
      landmarks,
    };
    if (hand.modelGesture !== undefined) {
      tracked.modelGesture = hand.modelGesture;
      tracked.modelGestureScore = hand.modelGestureScore;
    }
    return tracked;
  });
}

/** A canvas to draw the crop of one zone on. A model cannot be told to look at part of a video frame. */
function newCropSurface(): CanvasRenderingContext2D {
  const surface = document.createElement('canvas').getContext('2d');
  if (!surface) throw new Error('Cannot create a canvas for a zone crop.');
  return surface;
}

function drawCrop(
  surface: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  crop: PixelRect,
): HTMLCanvasElement {
  const { canvas } = surface;
  // Setting the size clears a canvas and is slow, so do it only when the size changes.
  if (canvas.width !== crop.width || canvas.height !== crop.height) {
    canvas.width = crop.width;
    canvas.height = crop.height;
  }
  surface.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return canvas;
}

/** Each tracker owns its models. Call `init` once, then `process` for every video frame. */
export class ZoneTracker {
  readonly options: Readonly<ZoneTrackerOptions>;
  /** How many models run on every frame. */
  readonly modelCount: number;
  /** The most hands one model follows. */
  readonly handsPerModel: number;

  private models: HandModel[] = [];
  /** `crops` only: the canvas for the crop of each zone. */
  private cropSurfaces: CanvasRenderingContext2D[] = [];
  private activeDelegate: TrackerDelegate = 'uninitialized';
  private loading?: Promise<void>;
  private disposed = false;

  constructor(options: ZoneTrackerOptions) {
    const { zones, layout } = options;
    if (!Number.isInteger(zones) || zones < 1 || zones > MAX_ZONES) {
      throw new RangeError(`A zone tracker has 1 to ${MAX_ZONES} zones, not ${zones}.`);
    }
    this.options = { ...options };
    this.modelCount = layout === 'crops' ? zones : 1;
    this.handsPerModel = layout === 'crops' ? HANDS_PER_ZONE : HANDS_PER_ZONE * zones;
  }

  /** Where the models run: on the GPU, or on the CPU when the GPU could not load them. */
  get delegate(): TrackerDelegate {
    return this.activeDelegate;
  }

  /** Loads the models. Calling it again returns the same load. */
  init(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error(DISPOSED));
    this.loading ??= this.load();
    return this.loading;
  }

  /** Finds the hands in the current video frame. It blocks until the models are done. */
  process(video: HTMLVideoElement, nowMs: number): ZoneFrame {
    if (this.activeDelegate === 'uninitialized') throw new Error('The zone tracker is not ready.');
    if (!video.videoWidth || !video.videoHeight) throw new Error('The camera has no picture yet.');

    const startedMs = performance.now();
    const found = this.options.layout === 'crops' ? this.trackCrops(video, nowMs) : this.trackFullFrame(video, nowMs);
    return { timeMs: nowMs, inferenceMs: performance.now() - startedMs, ...found };
  }

  dispose(): void {
    this.disposed = true;
    for (const model of this.models) model.close();
    this.models = [];
    this.cropSurfaces = [];
    this.activeDelegate = 'uninitialized';
  }

  private async load(): Promise<void> {
    let delegate: 'GPU' | 'CPU' = 'GPU';
    let models: HandModel[];
    try {
      models = await this.loadModels('GPU');
    } catch (error) {
      if (this.disposed) throw error;
      console.warn('Zone tracker: the GPU could not load the models. Using the CPU.', error);
      delegate = 'CPU';
      models = await this.loadModels('CPU');
    }

    this.models = models;
    if (this.options.layout === 'crops') this.cropSurfaces = models.map(newCropSurface);
    this.activeDelegate = delegate;
  }

  /**
   * Loads every model on one delegate. When one fails, or the tracker is disposed meanwhile,
   * the models loaded so far are closed: a tracker never runs partly on the GPU.
   */
  private async loadModels(delegate: 'GPU' | 'CPU'): Promise<HandModel[]> {
    const models: HandModel[] = [];
    try {
      while (models.length < this.modelCount) {
        models.push(await loadHandModel(this.options.model, this.handsPerModel, delegate));
        if (this.disposed) throw new Error(DISPOSED);
      }
      return models;
    } catch (error) {
      for (const model of models) model.close();
      throw error;
    }
  }

  private trackFullFrame(video: HTMLVideoElement, nowMs: number): Pick<ZoneFrame, 'zones'> {
    const { zones } = this.options;
    const frameAspect = video.videoWidth / video.videoHeight;
    const mirrorLandmarks = (landmarks: readonly Point[]): Point[] =>
      landmarks.map((landmark) => cropToFrame(landmark));

    const hands = trackedHands(this.models[0].find(video, nowMs), mirrorLandmarks, frameAspect);
    return {
      zones: Array.from({ length: zones }, (_, zone) => handsInZone(hands, zone, zones)),
    };
  }

  private trackCrops(video: HTMLVideoElement, nowMs: number): Pick<ZoneFrame, 'zones' | 'zoneInferenceMs'> {
    const { zones } = this.options;
    const { videoWidth, videoHeight } = video;
    const frameAspect = videoWidth / videoHeight;
    const handsPerZone: ZoneHand[][] = [];
    const zoneInferenceMs: number[] = [];

    for (let zone = 0; zone < zones; zone++) {
      const startedMs = performance.now();
      const crop = zoneCrop(zone, zones, videoWidth, videoHeight);
      const picture = drawCrop(this.cropSurfaces[zone], video, crop);
      const cropToMirroredFrame = (landmarks: readonly Point[]): Point[] =>
        cropLandmarksToFrame(landmarks, crop, videoWidth, videoHeight);

      const hands = trackedHands(this.models[zone].find(picture, nowMs), cropToMirroredFrame, frameAspect);
      // The crop reaches into the neighbour zones. A hand there belongs to the neighbour.
      handsPerZone.push(handsInZone(hands, zone, zones));
      zoneInferenceMs.push(performance.now() - startedMs);
    }
    return { zones: handsPerZone, zoneInferenceMs };
  }
}
