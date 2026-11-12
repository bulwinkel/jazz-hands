import type { Manifest } from './types';
export function synthetic(bpm = 100, seconds = 120): Manifest {
  const beats = Array.from({ length: Math.floor(seconds * bpm / 60) }, (_, i) => i * 60 / bpm);
  return { id: 'synthetic', title: 'Test', audio: '/test.mp3', durationSec: seconds, bpm, beatsPerBar: 4, firstDownbeat: 0, beats, intensity: beats.map(() => 0.8) };
}
