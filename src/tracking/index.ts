import { MediaPipeTracker } from './trackers';
import type { Tracker, TrackerMode, TrackerOptions } from './types';

export type * from './types';
export { startCamera } from './camera';
export { TRACKING_THRESHOLDS, TRACKER_MODES } from './config';

export function createTracker(mode: TrackerMode, options?: TrackerOptions): Tracker {
  return new MediaPipeTracker(mode, options);
}
