import type { FaceRegions, TrackerDelegate, TrackerMode, TrackingFrame } from './types';

/**
 * The messages between the page and a tracking worker. A worker holds one tracker. The page
 * gives every frame a number, and the worker answers with that number.
 */

/** What the page asks of the worker. */
export type WorkerRequest =
  | { type: 'load'; mode: TrackerMode; faces: boolean }
  | {
      type: 'track';
      frame: number;
      /** Transferred to the worker. The worker closes it. */
      picture: VideoFrame;
      /** The page's `performance.now()` when the camera frame was taken. */
      timeMs: number;
      faceRegions?: FaceRegions;
    };

export type LoadRequest = Extract<WorkerRequest, { type: 'load' }>;
export type TrackRequest = Extract<WorkerRequest, { type: 'track' }>;

/** What a tracker runs on, once it has loaded. */
export interface LoadedTracker {
  delegate: TrackerDelegate;
  faceDelegate: TrackerDelegate;
}

/** What the worker answers. An error travels as its message. */
export type WorkerAnswer =
  | ({ type: 'loaded' } & LoadedTracker)
  | { type: 'loadFailed'; error: string }
  | { type: 'tracked'; frame: number; result: TrackingFrame }
  | { type: 'trackFailed'; frame: number; error: string };
