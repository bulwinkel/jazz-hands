import { createTracker, startCamera } from '../tracking';
import type { GestureName, PlayerTracking, Tracker, TrackerMode, TrackingFrame } from '../tracking/types';
import { botPlayer } from './bot';
import { containRect } from './geometry';
import type { PlayerRun } from './player';
import type { Options } from './settings';
import type { Phase, PlayerCount, Point } from './types';

/** What an input needs to know about the game. Only the test inputs use it. */
export interface InputView {
  phase: Phase;
  songTimeSec: number;
  playerCount: PlayerCount;
  players: readonly Pick<PlayerRun, 'index' | 'cues' | 'grid'>[];
}

/** A source of tracking frames: the camera, or a stand-in for tests. */
export interface GameInput {
  readonly video?: HTMLVideoElement;
  /** Names for the debug overlay. */
  readonly mode: string;
  readonly delegate: string;
  init(): Promise<void>;
  start(
    view: () => InputView,
    onFrame: (frame: TrackingFrame) => void,
    onError: (error: unknown) => void,
  ): void;
  setMode(mode: TrackerMode): Promise<void>;
  dispose(): void;
}

/** The real input: the webcam, tracked by MediaPipe. */
export class CameraInput implements GameInput {
  video?: HTMLVideoElement;
  private tracker: Tracker;
  private running = false;
  private videoCallbackId = 0;
  private animationId = 0;
  private lastVideoTime = -1;

  constructor(mode: TrackerMode) {
    this.tracker = createTracker(mode);
  }

  get mode(): string {
    return this.tracker.mode;
  }

  get delegate(): string {
    return this.tracker.delegate;
  }

  async init(): Promise<void> {
    // Start both together, and wait for both, so a model failure never leaves the camera running.
    const [camera, models] = await Promise.allSettled([startCamera(), this.tracker.init()]);
    if (camera.status === 'fulfilled') this.video = camera.value;
    if (camera.status === 'rejected') {
      this.dispose();
      throw new Error(`Camera failed: ${String(camera.reason)}. Allow camera access in Chrome.`);
    }
    if (models.status === 'rejected') {
      this.dispose();
      throw new Error(`Model load failed: ${String(models.reason)}. Check the local model files.`);
    }
  }

  start(_view: () => InputView, onFrame: (frame: TrackingFrame) => void, onError: (error: unknown) => void): void {
    const video = this.video;
    if (!video) throw new Error('The camera is not ready.');
    this.running = true;

    const track = (): void => {
      if (!this.running) return;
      try {
        onFrame(this.tracker.process(video, performance.now()));
      } catch (error) {
        this.running = false;
        onError(error);
      }
    };

    // Track each camera frame once. Chrome tells us when a new frame arrives.
    if (typeof video.requestVideoFrameCallback === 'function') {
      const onVideoFrame = (): void => {
        track();
        if (this.running) this.videoCallbackId = video.requestVideoFrameCallback(onVideoFrame);
      };
      this.videoCallbackId = video.requestVideoFrameCallback(onVideoFrame);
      return;
    }
    // Other browsers: look for a new frame on every screen refresh.
    const onAnimationFrame = (): void => {
      if (!this.running) return;
      if (video.currentTime !== this.lastVideoTime && video.readyState >= 2) {
        this.lastVideoTime = video.currentTime;
        track();
      }
      this.animationId = requestAnimationFrame(onAnimationFrame);
    };
    this.animationId = requestAnimationFrame(onAnimationFrame);
  }

  /** Swaps the tracker only after the new one has loaded, so tracking never stops on a failure. */
  async setMode(mode: TrackerMode): Promise<void> {
    const replacement = createTracker(mode);
    try {
      await replacement.init();
    } catch (error) {
      replacement.dispose();
      throw error;
    }
    const old = this.tracker;
    this.tracker = replacement;
    old.dispose();
  }

  dispose(): void {
    this.running = false;
    if (this.videoCallbackId) this.video?.cancelVideoFrameCallback(this.videoCallbackId);
    cancelAnimationFrame(this.animationId);
    this.tracker.dispose();
    const stream = this.video?.srcObject as MediaStream | null | undefined;
    stream?.getTracks().forEach((track) => track.stop());
    this.video?.remove();
  }
}

const GESTURE_KEYS: Record<string, GestureName> = { '1': 'fist', '2': 'open', '3': 'point', '4': 'peace' };

/**
 * A stand-in for the camera, for tests and for trying the game at a desk.
 * `mouse`: the pointer is a hand. Hold 1 to 4 for fist, open, point or peace.
 * `bot`: simulated hands play the chart.
 */
export class SimulatedInput implements GameInput {
  readonly mode: string;
  readonly delegate = 'simulation';
  private readonly options: Options;
  private readonly surface: HTMLElement;
  private animationId = 0;
  private pointer: Point = { x: 0.25, y: 0.5 };
  private heldKeys = new Set<string>();

  constructor(options: Options, surface: HTMLElement) {
    this.options = options;
    this.surface = surface;
    this.mode = options.input;
  }

  async init(): Promise<void> {
    // Nothing to load: no camera and no models.
  }

  start(view: () => InputView, onFrame: (frame: TrackingFrame) => void): void {
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);

    const tick = (): void => {
      const current = view();
      const players = this.options.input === 'bot' ? this.botPlayers(current) : this.mousePlayers(current);
      onFrame({ timeMs: performance.now(), inferenceMs: 0, players });
      this.animationId = requestAnimationFrame(tick);
    };
    this.animationId = requestAnimationFrame(tick);
  }

  async setMode(): Promise<void> {
    // Tracker modes belong to the camera.
  }

  dispose(): void {
    cancelAnimationFrame(this.animationId);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  private botPlayers(view: InputView): [PlayerTracking, PlayerTracking] {
    const players: [PlayerTracking, PlayerTracking] = [{ hands: [] }, { hands: [] }];
    for (const player of view.players) {
      players[player.index] = botPlayer(
        view.phase,
        view.songTimeSec,
        player.cues,
        player.grid,
        this.options.botAccuracy,
        this.options.seed,
      );
    }
    return players;
  }

  private mousePlayers(view: InputView): [PlayerTracking, PlayerTracking] {
    const heldKey = Object.keys(GESTURE_KEYS).find((key) => this.heldKeys.has(key));
    const gesture: GestureName = heldKey ? GESTURE_KEYS[heldKey] : 'open';
    const handAt = (x: number): PlayerTracking => ({
      hands: [{ x, y: this.pointer.y, size: 0.05, gesture, gestureScore: 1 }],
    });

    if (view.playerCount === 1) return [handAt(this.pointer.x), { hands: [] }];
    // Two players share one pointer: fold it into the left half and mirror it into the right.
    const folded = this.pointer.x > 0.5 ? 1 - this.pointer.x : this.pointer.x;
    return [handAt(folded), handAt(1 - folded)];
  }

  private onPointerMove = (event: PointerEvent): void => {
    // The simulated camera frame is letterboxed at 16:9, the same as the renderer's default.
    const bounds = this.surface.getBoundingClientRect();
    const frame = containRect(bounds.width, bounds.height, 16 / 9);
    const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
    this.pointer = {
      x: clamp01((event.clientX - bounds.left - frame.x) / frame.width),
      y: clamp01((event.clientY - bounds.top - frame.y) / frame.height),
    };
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    this.heldKeys.add(event.key);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.heldKeys.delete(event.key);
  };

  private onBlur = (): void => {
    this.heldKeys.clear();
  };
}

export function createInput(options: Options, trackerMode: TrackerMode, surface: HTMLElement): GameInput {
  return options.input === 'camera' ? new CameraInput(trackerMode) : new SimulatedInput(options, surface);
}
