import { GAME_CONFIG as C } from './config';
import { medianInterval, tailStart } from './manifest';
import type { Cue, Level, Manifest } from './types';

export function randomSequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function masterCells(m: Manifest, seed: number): number[] {
  const random = randomSequence(seed); const cells: number[] = [];
  for (let i = 0; i < m.beats.length; i++) {
    const options = C.cellWeights.map((weight, cell) => ({ weight, cell })).filter(v => !cells.slice(-C.recentCells).includes(v.cell));
    let pick = random() * options.reduce((sum, o) => sum + o.weight, 0);
    cells.push(options.find(o => (pick -= o.weight) < 0)?.cell ?? options[options.length - 1].cell);
  }
  return cells;
}
export function selectStride(interval: number, minimum: number): number {
  return C.strides.find(stride => interval * stride >= minimum - 1e-8) ?? C.strides[C.strides.length - 1];
}
export function doubleCells(master: number, random: () => number): number[] {
  const row = Math.floor(master / 3);
  const column = master % 3 === 1 ? (random() < 0.5 ? 0 : 2) : master % 3;
  return [row * 3 + column, Math.floor(random() * 3) * 3 + (column === 0 ? 2 : 0)];
}
export function generateChart(m: Manifest, level: Level, seed: number, end = m.durationSec): Cue[] {
  const master = masterCells(m, seed);
  // Independent per-beat decoration draws keep levels 2 and 3 identical in position.
  const random = randomSequence(seed ^ 0xA519);
  const interval = medianInterval(m);
  const first = m.firstDownbeat + C.leadBars * m.beatsPerBar;
  const lead = Math.max(m.beats[first] ?? Infinity, C.leadSec);
  const tail = tailStart(m, end);
  const cues: Cue[] = [];
  for (let i = 0; i < m.beats.length; i++) {
    const chanceDouble = random(); const side = random(); const partner = random();
    const chanceGesture = random(); const shape = random();
    const timeSec = m.beats[i]; const intensity = m.intensity[i];
    if (timeSec < lead || timeSec >= tail) continue;
    const minimum = level > 1 && intensity >= C.highIntensity ? C.fastInterval : C.slowInterval;
    let stride = selectStride(interval, minimum);
    if (level === 1 && intensity < C.lowIntensity) stride *= 2;
    if ((i - m.firstDownbeat) % stride !== 0) continue;
    const previous = cues.at(-1);
    // A tempo/intensity transition must still honor the interval of the new cue.
    if (previous && i - previous.beatIndex < stride) continue;
    const isDouble = level > 1 && (i - m.firstDownbeat) % m.beatsPerBar === 0 && intensity >= C.highIntensity && chanceDouble < C.doubleChance;
    const draws = [side, partner];
    const cue: Cue = { timeSec, beatIndex: i, cells: isDouble ? doubleCells(master[i], () => draws.shift() ?? 0) : [master[i]] };
    if (level === 3 && !isDouble && chanceGesture < C.gestureChance && (!previous || timeSec - previous.timeSec >= C.gestureGapSec - 1e-8)) {
      cue.gesture = C.gesturePool[Math.floor(shape * C.gesturePool.length)];
    }
    cues.push(cue);
  }
  return cues;
}
