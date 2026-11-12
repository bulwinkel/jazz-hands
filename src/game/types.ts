import type { GestureName } from '../tracking/types';
export type Level = 1 | 2 | 3;
export type PlayerLevel = 0 | Level;
export interface Manifest {
  id: string; title: string; audio: string; durationSec: number; bpm: number;
  beatsPerBar: number; firstDownbeat: number; beats: number[]; intensity: number[];
}
export interface Cue { timeSec: number; beatIndex: number; cells: number[]; gesture?: GestureName; face?: string }
export interface Rect { x: number; y: number; width: number; height: number }
export interface Point { x: number; y: number }
export type Rating = 'perfect' | 'good' | 'miss';
export interface Score {
  score: number; combo: number; maxCombo: number; perfect: number; good: number; miss: number; total: number;
}
export type Phase = 'menu' | 'loading' | 'fit' | 'ready' | 'countdown' | 'play' | 'results' | 'error';
