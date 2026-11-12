import { FilesetResolver, GestureRecognizer, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { GestureRecognizerResult } from '@mediapipe/tasks-vision';
import { TRACKING_THRESHOLDS } from './config';
import { assignHands, cropToFrame, FULL_FRAME, gestureName, handSize, palmCentre, posePlayers } from './geometry';
import type { Crop } from './geometry';
import { shapeFromLandmarks } from './shapes';
import type { TrackedHand, Tracker, TrackerDelegate, TrackerMode, TrackingFrame } from './types';

let fileset: ReturnType<typeof FilesetResolver.forVisionTasks> | undefined;
function runtime() {
  return fileset ??= FilesetResolver.forVisionTasks('/vendor/tasks-vision-wasm');
}

function handsFromResult(result: GestureRecognizerResult, crop: Crop, aspect: number): TrackedHand[] {
  return result.landmarks.flatMap((raw, index) => {
    if (raw.length < 21) return [];
    const landmarks = raw.map((point) => cropToFrame(point, crop));
    const category = result.gestures[index]?.toSorted((a, b) => b.score - a.score)[0];
    // Read the shape from the fingers first: that works at any hand angle. The gesture model
    // only reads upright hands well, so it is the fallback, and it adds thumbs up and the like.
    const shapeFromFingers = shapeFromLandmarks(landmarks, aspect);
    return {
      ...palmCentre(landmarks),
      size: handSize(landmarks, aspect),
      gesture: shapeFromFingers ?? gestureName(category?.categoryName),
      gestureScore: shapeFromFingers ? 1 : category?.score ?? 0,
      landmarks,
    };
  });
}

/** Each instance owns its models. Repeated init() calls reuse the same promise. */
export class MediaPipeTracker implements Tracker {
  readonly mode: TrackerMode;
  private activeDelegate: TrackerDelegate = 'uninitialized';
  private initialization?: Promise<void>;
  private gestures: GestureRecognizer[] = [];
  private pose?: PoseLandmarker;
  private crops: HTMLCanvasElement[] = [];
  private disposed = false;

  constructor(mode: TrackerMode) { this.mode = mode; }
  get delegate(): TrackerDelegate { return this.activeDelegate; }

  init(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Tracker is disposed.'));
    return this.initialization ??= this.initialize();
  }

  private async initialize(): Promise<void> {
    const wasm = await runtime();
    const create = async (delegate: 'GPU' | 'CPU') => {
      const common = {
        runningMode: 'VIDEO' as const,
        ...(delegate === 'GPU' ? { canvas: document.createElement('canvas') } : {}),
        minTrackingConfidence: TRACKING_THRESHOLDS.tracking,
      };
      if (this.mode === 'pose') {
        this.pose = await PoseLandmarker.createFromOptions(wasm, {
          ...common, baseOptions: { modelAssetPath: '/models/pose_landmarker_full.task', delegate },
          numPoses: 2, minPoseDetectionConfidence: TRACKING_THRESHOLDS.detection,
          minPosePresenceConfidence: TRACKING_THRESHOLDS.presence, outputSegmentationMasks: false,
        });
      } else {
        for (let i = 0; i < (this.mode === 'hands-split' ? 2 : 1); i++) {
          const recognizer = await GestureRecognizer.createFromOptions(wasm, {
            ...common,
            // Never share a WebGL canvas between recognizers.
            ...(delegate === 'GPU' ? { canvas: document.createElement('canvas') } : {}),
            baseOptions: { modelAssetPath: '/models/gesture_recognizer.task', delegate },
            numHands: this.mode === 'hands-split' ? 2 : 4,
            minHandDetectionConfidence: TRACKING_THRESHOLDS.detection,
            minHandPresenceConfidence: TRACKING_THRESHOLDS.presence,
          });
          this.gestures.push(recognizer);
        }
      }
      this.activeDelegate = delegate;
    };
    if (this.disposed) throw new Error('Tracker is disposed.');
    try {
      await create('GPU');
    } catch (error) {
      this.closeModels();
      if (this.disposed) throw new Error('Tracker is disposed.');
      console.warn(`${this.mode}: GPU initialization failed; using CPU.`, error);
      try { await create('CPU'); } catch (cpuError) { this.closeModels(); throw cpuError; }
    }
    if (this.disposed) { this.closeModels(); throw new Error('Tracker is disposed.'); }
    if (this.mode === 'hands-split') {
      this.crops = [document.createElement('canvas'), document.createElement('canvas')];
    }
  }

  process(video: HTMLVideoElement, nowMs: number): TrackingFrame {
    if (this.disposed || this.delegate === 'uninitialized') throw new Error('Tracker is not ready.');
    if (!video.videoWidth || !video.videoHeight) throw new Error('Camera has no video frame.');
    const start = performance.now();
    const aspect = video.videoWidth / video.videoHeight;
    let players: TrackingFrame['players'];
    if (this.pose) {
      const result = this.pose.detectForVideo(video, nowMs);
      try { players = posePlayers(result.landmarks, aspect, TRACKING_THRESHOLDS.poseLandmarkVisibility); }
      finally { result.close(); }
    } else if (this.mode === 'hands-full') {
      players = assignHands(handsFromResult(this.gestures[0].recognizeForVideo(video, nowMs), FULL_FRAME, aspect));
    } else {
      const hands: TrackedHand[] = [];
      const split = Math.floor(video.videoWidth / 2);
      for (let rawHalf = 0; rawHalf < 2; rawHalf++) {
        const x = rawHalf === 0 ? 0 : split;
        const width = rawHalf === 0 ? split : video.videoWidth - split;
        const canvas = this.crops[rawHalf];
        if (canvas.width !== width || canvas.height !== video.videoHeight) {
          canvas.width = width; canvas.height = video.videoHeight;
        }
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Cannot create the crop canvas context.');
        context.drawImage(video, x, 0, width, video.videoHeight, 0, 0, width, video.videoHeight);
        const crop = { x: x / video.videoWidth, y: 0, width: width / video.videoWidth, height: 1 };
        hands.push(...handsFromResult(this.gestures[rawHalf].recognizeForVideo(canvas, nowMs), crop, aspect));
      }
      players = assignHands(hands); // Raw right half becomes mirrored player 0.
    }
    return { timeMs: nowMs, inferenceMs: performance.now() - start, players };
  }

  private closeModels(): void {
    for (const model of this.gestures) model.close();
    this.gestures = [];
    this.pose?.close(); this.pose = undefined;
    this.activeDelegate = 'uninitialized';
  }

  dispose(): void {
    this.disposed = true;
    this.closeModels();
    this.crops = [];
  }
}
