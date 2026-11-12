import type { Manifest } from './types';

/** A steady test song: a beat every 60 / bpm seconds, all at one intensity. */
export function synthetic(bpm = 100, seconds = 120, intensity = 0.8): Manifest {
  const beatCount = Math.floor((seconds * bpm) / 60);
  const beats = Array.from({ length: beatCount }, (_, beat) => (beat * 60) / bpm);
  return {
    id: 'synthetic',
    title: 'Test',
    audio: '/test.mp3',
    durationSec: seconds,
    bpm,
    beatsPerBar: 4,
    firstDownbeat: 0,
    beats,
    intensity: beats.map(() => intensity),
  };
}
