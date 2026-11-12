/** Shared thresholds for small hands at play distance. Record these with results. */
export const TRACKING_THRESHOLDS = Object.freeze({
  detection: 0.3,
  presence: 0.3,
  tracking: 0.3,
  poseLandmarkVisibility: 0.3,
});

export const TRACKER_MODES = ['hands-full', 'hands-split', 'pose'] as const;
