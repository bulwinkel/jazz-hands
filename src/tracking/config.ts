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

/**
 * How long a tracking worker may take before the page ends it. A worker that hangs sends no
 * error event, so without these limits tracking would stop for good and every cue would miss.
 * When a limit passes, the page ends that worker, fails what waits, and takes the failure path.
 */
export const WORKER_LIMITS = Object.freeze({
  /**
   * One tracker's load: its model files, the WASM runtime, and the GPU programs. It took 0.1 to
   * 1 s on this machine with a warm cache. A cold cache, a slow disk and a slow GPU can make it
   * many times longer, and a load that passes the limit loses its worker for nothing.
   */
  loadMs: 30_000,
  /**
   * One camera frame, from its hand-over to its answer. It takes 15 to 50 ms. The first frame of
   * a tracker builds GPU programs and took up to 0.4 s. A worker this far behind is not slow
   * but stuck. Judging waits no longer than this for a frame either.
   */
  frameMs: 5_000,
});
