import { GAME_CONFIG as C } from './config';
import type { Manifest } from './types';

export function validateManifest(value: unknown): Manifest {
  const fail = (message: string): never => { throw new Error(`Song manifest: ${message}`); };
  if (!value || typeof value !== 'object') return fail('expected an object.');
  const m = value as Manifest;
  if (typeof m.id !== 'string' || !m.id.trim() || typeof m.title !== 'string' || !m.title.trim()) fail('id and title are required.');
  if (typeof m.audio !== 'string' || !/^\/(?!\/)/.test(m.audio) || /[\\\s]/.test(m.audio)) fail('audio must be a local absolute path.');
  if (!Number.isFinite(m.durationSec) || m.durationSec <= 0 || !Number.isFinite(m.bpm) || m.bpm <= 0) fail('durationSec and bpm must be positive.');
  if (!Number.isInteger(m.beatsPerBar) || m.beatsPerBar < 1) fail('beatsPerBar must be a positive integer.');
  if (!Array.isArray(m.beats) || m.beats.length < 2 || m.beats.some((b, i) => !Number.isFinite(b) || b < 0 || b >= m.durationSec || (i > 0 && b <= m.beats[i - 1]))) fail('beats must be increasing times inside the song.');
  if (!Number.isInteger(m.firstDownbeat) || m.firstDownbeat < 0 || m.firstDownbeat >= m.beats.length) fail('firstDownbeat must be a beat index.');
  if (!Array.isArray(m.intensity) || m.intensity.length !== m.beats.length || m.intensity.some(v => !Number.isFinite(v) || v < 0 || v > 1)) fail('intensity must have one value from 0 to 1 per beat.');
  return m;
}
export function medianInterval(m: Manifest): number {
  const gaps = m.beats.slice(1).map((b, i) => b - m.beats[i]).sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
}
export function playLength(m: Manifest, length: 'short' | 'full'): number {
  if (length === 'full') return m.durationSec;
  return m.beats.find((t, i) => i >= m.firstDownbeat && (i - m.firstDownbeat) % m.beatsPerBar === 0 && t >= C.shortSec) ?? m.durationSec;
}
/** The final bar starts at the last bar boundary strictly before the endpoint. */
export function tailStart(m: Manifest, end: number): number {
  const bars = m.beats.filter((t, i) => i >= m.firstDownbeat && (i - m.firstDownbeat) % m.beatsPerBar === 0 && t < end - 1e-8);
  return bars.at(-C.tailBars) ?? 0;
}
