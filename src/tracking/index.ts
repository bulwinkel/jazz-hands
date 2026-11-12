import { MediaPipeTracker } from './trackers';
import type { Tracker, TrackerMode } from './types';

export type * from './types';
export { startCamera } from './camera';
export { TRACKING_THRESHOLDS, TRACKER_MODES } from './config';

export function createTracker(mode: TrackerMode): Tracker {
  return new MediaPipeTracker(mode);
}
