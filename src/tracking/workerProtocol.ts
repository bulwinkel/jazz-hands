import type { FaceRegions, TrackerDelegate, TrackerMode, TrackingFrame } from './types';

/**
 * The messages between the page and the tracking worker. The page gives every tracker and
 * every frame a number, and the worker answers with that number.
 */

/** What the page asks of the worker. */
export type WorkerRequest =
  | { type: 'load'; tracker: number; mode: TrackerMode; faces: boolean }
  | {
      type: 'track';
      tracker: number;
      frame: number;
      /** Transferred to the worker. The worker closes it. */
      picture: VideoFrame;
      /** The page's `performance.now()` when the camera frame was taken. */
      timeMs: number;
      faceRegions?: FaceRegions;
    }
  | { type: 'dispose'; tracker: number };

export type LoadRequest = Extract<WorkerRequest, { type: 'load' }>;
export type TrackRequest = Extract<WorkerRequest, { type: 'track' }>;

/** What a tracker runs on, once it has loaded. */
export interface LoadedTracker {
  delegate: TrackerDelegate;
  faceDelegate: TrackerDelegate;
}

/** What the worker answers. An error travels as its message. */
export type WorkerAnswer =
  | ({ type: 'loaded'; tracker: number } & LoadedTracker)
  | { type: 'loadFailed'; tracker: number; error: string }
  | { type: 'tracked'; frame: number; result: TrackingFrame }
  | { type: 'trackFailed'; frame: number; error: string };
