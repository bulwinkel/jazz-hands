import { CHART, TIMING } from './config';
import type { Manifest, SongLength } from './types';

const isText = (value: unknown): boolean => typeof value === 'string' && value.trim() !== '';
const isPositive = (value: unknown): boolean =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Returns the manifest, or throws an error that names the first bad field. */
export function validateManifest(value: unknown): Manifest {
  const fail = (message: string): never => {
    throw new Error(`Song manifest: ${message}`);
  };
  if (!value || typeof value !== 'object') return fail('expected an object.');
  const m = value as Manifest;

  if (!isText(m.id) || !isText(m.title)) fail('id and title are required.');

  // The game runs with no network, so audio must be a path on this server.
  const isLocalPath =
    typeof m.audio === 'string' && /^\/(?!\/)/.test(m.audio) && !/[\\\s]/.test(m.audio);
  if (!isLocalPath) fail('audio must be a local absolute path.');

  if (!isPositive(m.durationSec) || !isPositive(m.bpm)) fail('durationSec and bpm must be positive.');
  if (!Number.isInteger(m.beatsPerBar) || m.beatsPerBar < 1) fail('beatsPerBar must be a positive integer.');

  const beatsValid =
    Array.isArray(m.beats) &&
    m.beats.length >= 2 &&
    m.beats.every(
      (time, i) =>
        Number.isFinite(time) && time >= 0 && time < m.durationSec && (i === 0 || time > m.beats[i - 1]),
    );
  if (!beatsValid) fail('beats must be increasing times inside the song.');

  const downbeatValid =
    Number.isInteger(m.firstDownbeat) && m.firstDownbeat >= 0 && m.firstDownbeat < m.beats.length;
  if (!downbeatValid) fail('firstDownbeat must be a beat index.');

  const intensityValid =
    Array.isArray(m.intensity) &&
    m.intensity.length === m.beats.length &&
    m.intensity.every((value) => Number.isFinite(value) && value >= 0 && value <= 1);
  if (!intensityValid) fail('intensity must have one value from 0 to 1 per beat.');

  return m;
}

export function isBarStart(m: Manifest, beat: number): boolean {
  return beat >= m.firstDownbeat && (beat - m.firstDownbeat) % m.beatsPerBar === 0;
}

export function medianBeatInterval(m: Manifest): number {
  const gaps = m.beats.slice(1).map((time, i) => time - m.beats[i]);
  gaps.sort((a, b) => a - b);
  const middle = Math.floor(gaps.length / 2);
  return gaps.length % 2 ? gaps[middle] : (gaps[middle - 1] + gaps[middle]) / 2;
}

/** Where play ends. Short stops on a bar start, so the fade-out lands on the music. */
export function playLengthSec(m: Manifest, length: SongLength): number {
  if (length === 'full') return m.durationSec;
  const barStart = m.beats.find((time, beat) => isBarStart(m, beat) && time >= TIMING.shortSec);
  return barStart ?? m.durationSec;
}

/** The first moment a cue may be due: after the lead-in bars and the lead-in seconds. */
export function leadInEndSec(m: Manifest): number {
  const afterLeadBars = m.beats[m.firstDownbeat + CHART.leadBars * m.beatsPerBar] ?? Infinity;
  return Math.max(afterLeadBars, CHART.leadSec);
}

/** Start of the cue-free tail: the last bar start before `endSec` (with `tailBars` of 1). */
export function tailStartSec(m: Manifest, endSec: number): number {
  const barStarts = m.beats.filter((time, beat) => isBarStart(m, beat) && time < endSec - 1e-8);
  return barStarts.at(-CHART.tailBars) ?? 0;
}
