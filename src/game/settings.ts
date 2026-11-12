import type { TrackerMode } from '../tracking/types';
import { DEFAULT_TRACKER_MODE, GAME_CONFIG as C, SONGS } from './config';
import type { PlayerLevel } from './types';
export interface Settings {
  levels: [PlayerLevel, PlayerLevel]; length: 'short' | 'full'; tracker: TrackerMode;
  inputLatencyMs: number; avOffsetMs: number; songIndex: number;
}
export interface Options { settings: Settings; input: 'camera' | 'mouse' | 'bot'; start: number; autostart: boolean; seed: number; botAccuracy: number }
export const STORAGE_KEY = 'dance-game-v1';
export function defaultSettings(): Settings { return { levels: [2, 1], length: 'short', tracker: DEFAULT_TRACKER_MODE, inputLatencyMs: C.inputLatencyMs, avOffsetMs: C.avOffsetMs, songIndex: 0 }; }
function level(v: unknown): v is PlayerLevel { return Number.isInteger(v) && Number(v) >= 0 && Number(v) <= 3; }
function mode(v: unknown): v is TrackerMode { return v === 'hands-full' || v === 'hands-split' || v === 'pose'; }
function finite(v: unknown, fallback: number, min: number, max: number): number { return typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback; }
export function parseSettings(stored: unknown, query: string): Options {
  const s = defaultSettings();
  if (stored && typeof stored === 'object') {
    const v = stored as Partial<Settings>;
    if (Array.isArray(v.levels) && v.levels.length === 2 && v.levels.every(level)) s.levels = [...v.levels];
    if (v.length === 'short' || v.length === 'full') s.length = v.length;
    if (mode(v.tracker)) s.tracker = v.tracker;
    if (Number.isInteger(v.songIndex) && v.songIndex! >= 0 && v.songIndex! < SONGS.length) s.songIndex = v.songIndex!;
    s.inputLatencyMs = finite(v.inputLatencyMs, s.inputLatencyMs, -1000, 2000);
    s.avOffsetMs = finite(v.avOffsetMs, s.avOffsetMs, -2000, 2000);
  }
  const p = new URLSearchParams(query);
  ([0, 1] as const).forEach(i => { const n = Number(p.get(`p${i}`)); if (p.has(`p${i}`) && level(n)) s.levels[i] = n; });
  if (s.levels.every(l => l === 0)) s.levels[0] = 2;
  if (p.get('length') === 'short' || p.get('length') === 'full') s.length = p.get('length') as Settings['length'];
  if (mode(p.get('tracker'))) s.tracker = p.get('tracker') as TrackerMode;
  const source = p.get('input');
  const start = p.has('start') ? finite(Number(p.get('start')), 0, 0, 86400) : 0;
  const seed = p.has('seed') && Number.isInteger(Number(p.get('seed'))) ? Number(p.get('seed')) : C.seed;
  return { settings: s, input: source === 'mouse' || source === 'bot' ? source : 'camera', start,
    autostart: p.get('autostart') === '1', seed, botAccuracy: p.has('botAccuracy') ? finite(Number(p.get('botAccuracy')), 1, 0, 1) : 1 };
}
