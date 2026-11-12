import { createTracker, startCamera } from '../tracking';
import type { GestureName, Tracker, TrackerMode, TrackingFrame } from '../tracking/types';
import { botPlayer } from './bot';
import type { Options } from './settings';
import type { Cue, Phase, PlayerLevel, Rect } from './types';
export interface InputView { phase: Phase; songTime: number; cues: [Cue[], Cue[]]; grids: [Rect, Rect]; levels: [PlayerLevel, PlayerLevel] }
export interface GameInput {
  readonly video?: HTMLVideoElement;
  readonly mode: string; readonly delegate: string;
  init(): Promise<void>;
  start(view: () => InputView, onFrame: (frame: TrackingFrame) => void, onError: (error: unknown) => void): void;
  setMode(mode: TrackerMode): Promise<void>;
  dispose(): void;
}
export class CameraInput implements GameInput {
  video?: HTMLVideoElement;
  private tracker: Tracker;
  private running = false;
  private frameId = 0;
  private fallbackId = 0;
  private lastTime = -1;
  constructor(mode: TrackerMode) { this.tracker = createTracker(mode); }
  get mode(): string { return this.tracker.mode; }
  get delegate(): string { return this.tracker.delegate; }
  async init(): Promise<void> {
    // Initialize concurrently, but do not abandon a late camera stream on model failure.
    const results = await Promise.allSettled([startCamera(), this.tracker.init()]);
    if (results[0].status === 'fulfilled') this.video = results[0].value;
    else { this.dispose(); throw new Error(`Camera failed: ${String(results[0].reason)}. Allow camera access in Chrome.`); }
    if (results[1].status === 'rejected') { this.dispose(); throw new Error(`Model load failed: ${String(results[1].reason)}. Check local model assets.`); }
  }
  start(_view: () => InputView, onFrame: (frame: TrackingFrame) => void, onError: (error: unknown) => void): void {
    this.running = true;
    const process = () => {
      if (!this.running || !this.video) return;
      try { onFrame(this.tracker.process(this.video, performance.now())); }
      catch (error) { this.running = false; onError(error); }
    };
    const video = this.video!;
    if (typeof video.requestVideoFrameCallback === 'function') {
      const frame = () => { process(); if (this.running) this.frameId = video.requestVideoFrameCallback(frame); };
      this.frameId = video.requestVideoFrameCallback(frame);
    } else {
      const frame = () => {
        if (!this.running) return;
        if (video.currentTime !== this.lastTime && video.readyState >= 2) { this.lastTime = video.currentTime; process(); }
        this.fallbackId = requestAnimationFrame(frame);
      };
      this.fallbackId = requestAnimationFrame(frame);
    }
  }
  async setMode(mode: TrackerMode): Promise<void> {
    const replacement = createTracker(mode);
    try { await replacement.init(); } catch (error) { replacement.dispose(); throw error; }
    const old = this.tracker; this.tracker = replacement; old.dispose();
  }
  dispose(): void {
    this.running = false;
    if (this.frameId) this.video?.cancelVideoFrameCallback(this.frameId);
    cancelAnimationFrame(this.fallbackId); this.tracker.dispose();
    (this.video?.srcObject as MediaStream | null)?.getTracks().forEach(track => track.stop());
    this.video?.remove();
  }
}
export class SimulatedInput implements GameInput {
  readonly mode: string;
  readonly delegate = 'simulation';
  private frameId = 0;
  private point = { x: 0.25, y: 0.5 };
  private keys = new Set<string>();
  private options: Options;
  private surface: HTMLElement;
  private move = (event: PointerEvent) => {
    const r = this.surface.getBoundingClientRect();
    // The simulated full frame has the same 16:9 letterbox as the renderer.
    const w = Math.min(r.width, r.height * 16 / 9); const h = w * 9 / 16;
    const x = Math.max(0, Math.min(1, (event.clientX - r.left - (r.width - w) / 2) / w));
    this.point = { x: x > 0.5 ? 1 - x : x, y: Math.max(0, Math.min(1, (event.clientY - r.top - (r.height - h) / 2) / h)) };
  };
  private down = (e: KeyboardEvent) => { this.keys.add(e.key); };
  private up = (e: KeyboardEvent) => { this.keys.delete(e.key); };
  private blur = () => { this.keys.clear(); };
  constructor(options: Options, surface: HTMLElement) { this.options = options; this.surface = surface; this.mode = options.input; }
  async init(): Promise<void> { /* No camera or models in test modes. */ }
  start(view: () => InputView, onFrame: (frame: TrackingFrame) => void): void {
    window.addEventListener('pointermove', this.move); window.addEventListener('keydown', this.down);
    window.addEventListener('keyup', this.up); window.addEventListener('blur', this.blur);
    const frame = () => {
      const v = view();
      const gesture: GestureName = this.keys.has('1') ? 'fist' : this.keys.has('2') ? 'open' : this.keys.has('3') ? 'point' : this.keys.has('4') ? 'peace' : 'open';
      const players = ([0, 1] as const).map(i => this.options.input === 'bot'
        ? botPlayer(v.phase, v.songTime, v.cues[i], v.grids[i], Boolean(v.levels[i]), this.options.botAccuracy, this.options.seed)
        : { hands: [{ x: i === 0 ? this.point.x : 1 - this.point.x, y: this.point.y, size: 0.05, gesture, gestureScore: 1 }] });
      onFrame({ timeMs: performance.now(), inferenceMs: 0, players: [players[0], players[1]] });
      this.frameId = requestAnimationFrame(frame);
    };
    this.frameId = requestAnimationFrame(frame);
  }
  async setMode(): Promise<void> { /* Tracker modes only apply to the camera. */ }
  dispose(): void {
    cancelAnimationFrame(this.frameId); window.removeEventListener('pointermove', this.move);
    window.removeEventListener('keydown', this.down); window.removeEventListener('keyup', this.up); window.removeEventListener('blur', this.blur);
  }
}
export function createInput(options: Options, surface: HTMLElement): GameInput {
  return options.input === 'camera' ? new CameraInput(options.settings.tracker) : new SimulatedInput(options, surface);
}
