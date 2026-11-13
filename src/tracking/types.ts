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
  /**
   * Present only when a face region was requested for this player and a face was found in it.
   * With two regions requested, the tracker reads one face per frame, in turns. This is then
   * the face from the player's last turn, one frame old, in every second frame.
   */
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
  /** The page's performance.now() when the processed video frame was taken. */
  timeMs: number;
  inferenceMs: number;
  /**
   * The camera frame's time on the camera stream's own clock, in seconds. The camera input
   * sets it. Scripts use it to match the frames of two runs on one camera file.
   */
  videoTimeSec?: number;
  /** Player 0 occupies the left half of the mirrored display. */
  players: [PlayerTracking, PlayerTracking];
}

/**
 * What a tracker reads a camera frame from: the video element on the page, or a VideoFrame
 * of it in the tracking worker, which has no document.
 */
export type CameraPicture = HTMLVideoElement | VideoFrame;

/** Where the trackers run: on the page's main thread, or in the tracking worker. */
export type TrackingThread = 'main' | 'worker';

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
   * Run synchronous inference on one camera frame. Call once per frame.
   * Face work happens only for the regions given, and only in a tracker created with faces.
   */
  process(picture: CameraPicture, nowMs: number, faceRegions?: FaceRegions): TrackingFrame;
  dispose(): void;
}
