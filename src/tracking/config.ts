/** Shared thresholds for small hands at play distance. Record these with results. */
export const TRACKING_THRESHOLDS = Object.freeze({
  detection: 0.3,
  presence: 0.3,
  tracking: 0.3,
  poseLandmarkVisibility: 0.3,
});

export const TRACKER_MODES = ['hands-full', 'hands-split', 'pose'] as const;

/**
 * Confidence thresholds for the face model. They are below MediaPipe's default of 0.5,
 * because a face at play distance is small and soft, even inside its crop.
 */
export const FACE_THRESHOLDS = Object.freeze({
  detection: 0.3,
  presence: 0.3,
  tracking: 0.3,
});

/**
 * With two faces to read, the tracker reads one face per frame, in turns: reading both costs
 * too much time in one frame. In the frame of the other player's turn, a player keeps the
 * face from their own last turn, unless it is older than this.
 */
export const FACE_MAX_AGE_MS = 100;
