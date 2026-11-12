import { createTracker, startCamera } from '../tracking';
import type {
  FaceRegions,
  GestureName,
  PlayerTracking,
  Tracker,
  TrackerMode,
  TrackingFrame,
} from '../tracking/types';
import { botPlayer } from './bot';
import { containRect } from './geometry';
import type { PlayerRun } from './player';
import type { Options } from './settings';
import type { Phase, PlayerCount, Point } from './types';

/** What an input needs to know about the game. The camera uses the face regions only. */
export interface InputView {
  phase: Phase;
  songTimeSec: number;
  playerCount: PlayerCount;
  players: readonly Pick<PlayerRun, 'index' | 'cues' | 'faceCues' | 'grid'>[];
  /** Where to look for each player's face in this frame. Null while the game needs no face. */
  faceRegions: FaceRegions;
}

/** A source of tracking frames: the camera, or a stand-in for tests. */
export interface GameInput {
  readonly video?: HTMLVideoElement;
  /** Names for the debug overlay and the run report. */
  readonly mode: string;
  readonly delegate: string;
  /** What the face models run on. Unset for an input that loads no face model. */
  readonly faceDelegate?: string;
  init(): Promise<void>;
  start(
    view: () => InputView,
    onFrame: (frame: TrackingFrame) => void,
    onError: (error: unknown) => void,
  ): void;
  /** Switches the tracker. With `faces`, the tracker also has the face models loaded. */
  setMode(mode: TrackerMode, faces?: boolean): Promise<void>;
  dispose(): void;
}

/** The real input: the webcam, tracked by MediaPipe. */
export class CameraInput implements GameInput {
  video?: HTMLVideoElement;
  private tracker: Tracker;
  /** Trackers that are loaded, by mode. The menu and the rounds switch between them often. */
  private readonly loaded = new Map<TrackerMode, Tracker>();
  private running = false;
  private disposed = false;
  private videoCallbackId = 0;
  private animationId = 0;
  private lastVideoTime = -1;

  constructor(mode: TrackerMode) {
    this.tracker = createTracker(mode);
    this.loaded.set(mode, this.tracker);
  }

  get mode(): string {
    return this.tracker.mode;
  }

  get delegate(): string {
    return this.tracker.delegate;
  }

  get faceDelegate(): string | undefined {
    const { faceDelegate } = this.tracker;
    return faceDelegate === 'uninitialized' ? undefined : faceDelegate;
  }

  async init(): Promise<void> {
    // Keep the camera as soon as it starts, so `dispose` can stop it even while the models
    // still load. A camera that starts after `dispose` is stopped at once.
    const cameraStarted = startCamera().then((video) => {
      this.video = video;
      if (this.disposed) this.stopCamera();
    });
    // Wait for both, so a model failure never leaves the camera running.
    const [camera, models] = await Promise.allSettled([cameraStarted, this.tracker.init()]);
    if (camera.status === 'rejected') {
      this.dispose();
      throw new Error(`Camera failed: ${String(camera.reason)}. Allow camera access in Chrome.`);
    }
    if (models.status === 'rejected') {
      this.dispose();
      throw new Error(`Model load failed: ${String(models.reason)}. Check the local model files.`);
    }
  }

  start(view: () => InputView, onFrame: (frame: TrackingFrame) => void, onError: (error: unknown) => void): void {
    const video = this.video;
    if (!video) throw new Error('The camera is not ready.');
    this.running = true;

    const track = (): void => {
      if (!this.running) return;
      try {
        onFrame(this.tracker.process(video, performance.now(), view().faceRegions));
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

  /**
   * Switches the tracker. A mode loads once and is then kept, so switching back is instant.
   * The switch happens only after the new tracker has loaded, so tracking never stops on a failure.
   *
   * With `faces`, the tracker must have the face models. The menu loads its tracker before
   * anyone has chosen faces, so a mode that was loaded without them loads once more, with them.
   * A tracker with the face models also serves a round without faces: it reads a face only
   * where the game asks for one.
   */
  async setMode(mode: TrackerMode, faces = false): Promise<void> {
    const loaded = this.loaded.get(mode);
    const isUsable = loaded !== undefined && (!faces || loaded.faceDelegate !== 'uninitialized');
    if (isUsable) {
      this.tracker = loaded;
      return;
    }

    const next = createTracker(mode, { faces });
    try {
      await next.init();
    } catch (error) {
      next.dispose();
      throw error;
    }
    if (this.disposed) {
      next.dispose(); // The input was closed while this tracker loaded.
      return;
    }
    // Switch first, then let go of the tracker of this mode that had no face models.
    const replaced = this.loaded.get(mode);
    this.loaded.set(mode, next);
    this.tracker = next;
    replaced?.dispose();
  }

  dispose(): void {
    this.running = false;
    this.disposed = true;
    if (this.videoCallbackId) this.video?.cancelVideoFrameCallback(this.videoCallbackId);
    cancelAnimationFrame(this.animationId);
    for (const tracker of this.loaded.values()) tracker.dispose();
    this.stopCamera();
  }

  private stopCamera(): void {
    const stream = this.video?.srcObject as MediaStream | null | undefined;
    stream?.getTracks().forEach((track) => track.stop());
    this.video?.remove();
  }
}

const GESTURE_KEYS: Record<string, GestureName> = { '1': 'fist', '2': 'open', '3': 'point', '4': 'peace' };

/**
 * A stand-in for the camera, for tests and for trying the game at a desk.
 * `mouse`: the pointer is a hand. Hold 1 to 4 for fist, open, point or peace.
 * `bot`: simulated hands, and a simulated face, play the chart.
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
      const tracked = botPlayer(
        view.phase,
        view.songTimeSec,
        player.cues,
        player.grid,
        this.options.botAccuracy,
        this.options.seed,
        player.faceCues,
      );
      // The camera tracker reports a face only where the game asked for one. The bot does
      // the same, so a bot run also proves that the game asks at the right times.
      const faceAskedFor = view.faceRegions[player.index] !== null;
      players[player.index] = faceAskedFor ? tracked : { hands: tracked.hands };
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
