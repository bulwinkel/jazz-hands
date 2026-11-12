export type GestureName =
  | 'fist' | 'open' | 'point' | 'peace' | 'thumbsUp' | 'thumbsDown' | 'rock'
  | 'none' // A hand was seen, with no known gesture.
  | 'unknown'; // This mode cannot classify gestures.

export interface Point { x: number; y: number }

export interface TrackedHand {
  /** Palm centre in mirrored display space, normalised to the full camera frame. */
  x: number;
  y: number;
  /** Hand bounding-box diagonal as a fraction of the full frame height. */
  size: number;
  gesture: GestureName;
  /** 0..1; zero when gesture is unknown. */
  gestureScore: number;
  /** Full-frame mirrored coordinates, for debug drawing only. */
  landmarks?: Point[];
}

export interface PlayerTracking { hands: TrackedHand[] }

export interface TrackingFrame {
  /** performance.now() when the processed video frame was taken. */
  timeMs: number;
  inferenceMs: number;
  /** Player 0 occupies the left half of the mirrored display. */
  players: [PlayerTracking, PlayerTracking];
}

export type TrackerMode = 'hands-full' | 'hands-split' | 'pose';
export type TrackerDelegate = 'GPU' | 'CPU' | 'uninitialized';

export interface Tracker {
  readonly mode: TrackerMode;
  readonly delegate: TrackerDelegate;
  init(): Promise<void>;
  /** Run synchronous inference on the current video frame. Call once per frame. */
  process(video: HTMLVideoElement, nowMs: number): TrackingFrame;
  dispose(): void;
}
