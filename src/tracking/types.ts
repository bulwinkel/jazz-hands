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

export type FaceExpression = 'smile' | 'openMouth' | 'pucker';

export interface TrackedFace {
  /** Face centre in mirrored display space, normalised to the full frame. */
  x: number;
  y: number;
  /** Strength of each expression, 0..1. */
  expressions: Record<FaceExpression, number>;
}

export interface PlayerTracking {
  hands: TrackedHand[];
  /** Present only when a face region was requested for this player and a face was found in it. */
  face?: TrackedFace;
}

/** A rectangle, as fractions of the camera frame. */
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where to look for each player's face, in mirrored display space. Null skips that player. */
export type FaceRegions = [Region | null, Region | null];

export interface TrackingFrame {
  /** performance.now() when the processed video frame was taken. */
  timeMs: number;
  inferenceMs: number;
  /** Player 0 occupies the left half of the mirrored display. */
  players: [PlayerTracking, PlayerTracking];
}

export type TrackerMode = 'hands-full' | 'hands-split' | 'pose';
export type TrackerDelegate = 'GPU' | 'CPU' | 'uninitialized';

export interface TrackerOptions {
  /** Load the face model with the hand models, so the first face region causes no hitch. */
  faces?: boolean;
}

export interface Tracker {
  readonly mode: TrackerMode;
  readonly delegate: TrackerDelegate;
  /** What the face models run on. 'uninitialized' for a tracker created without faces. */
  readonly faceDelegate: TrackerDelegate;
  init(): Promise<void>;
  /**
   * Run synchronous inference on the current video frame. Call once per frame.
   * Face work happens only for the regions given, and only in a tracker created with faces.
   */
  process(video: HTMLVideoElement, nowMs: number, faceRegions?: FaceRegions): TrackingFrame;
  dispose(): void;
}
