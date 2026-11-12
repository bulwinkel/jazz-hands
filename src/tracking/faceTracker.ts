import { FaceLandmarker } from '@mediapipe/tasks-vision';
import { FACE_THRESHOLDS } from './config';
import { expressionsFromBlendshapes, faceCentre, pixelsToCrop, regionToRawPixels } from './faces';
import type { FaceRegions, Region, TrackedFace, TrackerDelegate } from './types';

type WasmFileset = Parameters<typeof FaceLandmarker.createFromOptions>[0];
type PlayerSlot = 0 | 1;

const MODEL_PATH = '/models/face_landmarker.task';
const PLAYER_SLOT_COUNT = 2;
/** Side of the empty picture the models run on once while they load, in pixels. */
const WARM_UP_SIZE = 256;

/**
 * Reads each player's facial expression from a crop of the camera frame.
 *
 * At play distance a face is about 7% of the frame width. That is too small for the face
 * detector on the whole frame, and large enough inside a crop around the player's head.
 */
export class FaceTracker {
  /**
   * One landmarker per player slot. In VIDEO mode a landmarker follows one face from
   * frame to frame, so two players cannot share one.
   */
  private landmarkers: FaceLandmarker[] = [];
  /** The crop each landmarker reads, one per player slot. */
  private crops: HTMLCanvasElement[] = [];
  private activeDelegate: TrackerDelegate = 'uninitialized';
  private disposed = false;

  get delegate(): TrackerDelegate {
    return this.activeDelegate;
  }

  /** Loads the face models on the GPU, or on the CPU when the GPU fails. */
  async init(wasm: WasmFileset): Promise<void> {
    try {
      await this.createLandmarkers(wasm, 'GPU');
    } catch (error) {
      this.closeLandmarkers();
      if (this.disposed) throw new Error('Tracker is disposed.');
      console.warn('faces: GPU initialization failed; using CPU.', error);
      try {
        await this.createLandmarkers(wasm, 'CPU');
      } catch (cpuError) {
        this.closeLandmarkers();
        throw cpuError;
      }
    }
    this.crops = [document.createElement('canvas'), document.createElement('canvas')];
    this.warmUp();
  }

  /**
   * Runs each model once on an empty picture. A model builds its GPU programs the first time
   * it runs, and that takes a few hundred milliseconds. Here it happens while the game still
   * shows its loading message. Without it, the game would freeze at the first face cue.
   */
  private warmUp(): void {
    const empty = document.createElement('canvas');
    empty.width = WARM_UP_SIZE;
    empty.height = WARM_UP_SIZE;
    empty.getContext('2d')?.fillRect(0, 0, WARM_UP_SIZE, WARM_UP_SIZE);
    for (const landmarker of this.landmarkers) landmarker.detectForVideo(empty, performance.now());
  }

  /** Looks for one face in each region given. The result has one entry per player slot. */
  detect(
    video: HTMLVideoElement,
    nowMs: number,
    regions: FaceRegions,
  ): [TrackedFace | undefined, TrackedFace | undefined] {
    if (this.delegate === 'uninitialized') throw new Error('Face tracker is not ready.');
    const faceOf = (slot: PlayerSlot): TrackedFace | undefined => {
      const region = regions[slot];
      return region ? this.detectInRegion(video, nowMs, region, slot) : undefined;
    };
    return [faceOf(0), faceOf(1)];
  }

  dispose(): void {
    this.disposed = true;
    this.closeLandmarkers();
    this.crops = [];
  }

  private async createLandmarkers(wasm: WasmFileset, delegate: 'GPU' | 'CPU'): Promise<void> {
    while (this.landmarkers.length < PLAYER_SLOT_COUNT) {
      const landmarker = await FaceLandmarker.createFromOptions(wasm, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate },
        runningMode: 'VIDEO',
        // Each GPU model draws in its own WebGL canvas. Sharing one breaks both models.
        ...(delegate === 'GPU' ? { canvas: document.createElement('canvas') } : {}),
        numFaces: 1,
        outputFaceBlendshapes: true,
        minFaceDetectionConfidence: FACE_THRESHOLDS.detection,
        minFacePresenceConfidence: FACE_THRESHOLDS.presence,
        minTrackingConfidence: FACE_THRESHOLDS.tracking,
      });
      // Keep it at once, so a failure on the next one still closes this one.
      this.landmarkers.push(landmarker);
      // The tracker can be disposed while a model loads. Stop here: `init` closes what has loaded.
      if (this.disposed) throw new Error('Tracker is disposed.');
    }
    this.activeDelegate = delegate;
  }

  private detectInRegion(
    video: HTMLVideoElement,
    nowMs: number,
    region: Region,
    slot: PlayerSlot,
  ): TrackedFace | undefined {
    const pixels = regionToRawPixels(region, video.videoWidth, video.videoHeight);
    if (!pixels) return undefined;

    const canvas = this.crops[slot];
    // Setting a canvas size clears the canvas, so set it only when the crop changes.
    if (canvas.width !== pixels.width || canvas.height !== pixels.height) {
      canvas.width = pixels.width;
      canvas.height = pixels.height;
    }
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Cannot create the face crop canvas context.');
    context.drawImage(
      video,
      pixels.x,
      pixels.y,
      pixels.width,
      pixels.height,
      0,
      0,
      pixels.width,
      pixels.height,
    );

    const result = this.landmarkers[slot].detectForVideo(canvas, nowMs);
    const landmarks = result.faceLandmarks[0];
    const blendshapes = result.faceBlendshapes[0];
    if (!landmarks?.length || !blendshapes) return undefined;

    const crop = pixelsToCrop(pixels, video.videoWidth, video.videoHeight);
    return {
      ...faceCentre(landmarks, crop),
      expressions: expressionsFromBlendshapes(blendshapes.categories),
    };
  }

  private closeLandmarkers(): void {
    for (const landmarker of this.landmarkers) landmarker.close();
    this.landmarkers = [];
    this.activeDelegate = 'uninitialized';
  }
}
