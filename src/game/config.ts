import type { GestureName, TrackerMode } from '../tracking/types';

export const DEFAULT_TRACKER_MODE: TrackerMode = 'hands-split';
export const SONGS = [{ manifest: '/songs/blessed-on-the-hillside.json', title: 'Blessed on the Hillside' }] as const;
export const GAME_CONFIG = {
  seed: 20261112,
  recentCells: 4,
  cellWeights: [1.2, 1.2, 1.2, 1, 0.4, 1, 0.7, 0.7, 0.7],
  leadBars: 2, leadSec: 4, tailBars: 1,
  strides: [1, 2, 4, 8], slowInterval: 1.1, fastInterval: 0.55,
  lowIntensity: 0.35, highIntensity: 0.5,
  doubleChance: 0.3, gestureChance: 0.35, gestureGapSec: 1,
  gesturePool: ['fist', 'open', 'point', 'peace'] as GestureName[],
  windows: { 1: { perfect: [-150, 200], good: [-350, 450] },
    2: { perfect: [-120, 160], good: [-280, 350] },
    3: { perfect: [-120, 160], good: [-280, 350] } },
  cellMargin: 0.12,
  defaultGridWidth: 0.42, defaultGridTop: 0.1, defaultGridHeight: 0.8,
  walkBackSec: 8, fitSec: 6, fitMinSamples: 20, fitPercentiles: [0.02, 0.98],
  minGridWidth: 0.18, minGridHeight: 0.3, halfMargin: 0.01,
  inputLatencyMs: 100, avOffsetMs: 0,
  shortSec: 90, fadeSec: 2,
  approach: { 1: 1.4, 2: 1, 3: 1 },
  readyHoldSec: 1, replayHoldSec: 1.5, countdownSec: 3,
  botLeadSec: 0.3, botHoldSec: 0.2,
  feedbackSec: 0.6,
} as const;
export const PLAYER_COLORS = ['#22d3ee', '#e879f9'] as const;
export const GESTURE_EMOJI: Partial<Record<GestureName, string>> = {
  fist: '✊', open: '✋', point: '☝️', peace: '✌️', thumbsUp: '👍', thumbsDown: '👎', rock: '🤘',
};
