import { startCamera } from '../tracking';
import { CameraTracking } from '../tracking/cameraTracking';
import type {
  FaceRegions,
  GestureName,
  PlayerTracking,
  TrackerMode,
  TrackingFrame,
  TrackingThread,
} from '../tracking/types';
import { botPlayer } from './bot';
import { DEFAULT_SEED } from './config';
import { containRect } from './geometry';
import { clamp01 } from './numbers';
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

/**
 * Where the mouse puts the hands, as x positions in the frame: player 1's hand, then player 2's
 * or null for none.
 *
 * In a round, two players share the one pointer: it is folded into the left half for player 1
 * and mirrored into the right half for player 2, so one mouse raises the hands of both. The
 * menu has no player areas and each player has a pointer of their own there (see
 * playerPointers.ts), so a mirrored hand would choose a second item. There the mouse is one
 * hand, where the pointer is.
 */
export function mouseHandPositions(pointerX: number, playerCount: PlayerCount, phase: Phase): [number, number | null] {
  if (playerCount === 1 || phase === 'menu') return [pointerX, null];
  const folded = pointerX > 0.5 ? 1 - pointerX : pointerX;
  return [folded, 1 - folded];
}

/** A source of tracking frames: the camera, or a stand-in for tests. */
export interface GameInput {
  readonly video?: HTMLVideoElement;
  /** Names for the debug overlay and the run report. */
  readonly mode: string;
  readonly delegate: string;
  /** What the face models run on. Unset for an input that loads no face model. */
  readonly faceDelegate?: string;
  /** Where the trackers run. Unset for a test input, which does no tracking. */
  readonly thread?: TrackingThread;
  /**
   * The page time of the oldest camera frame, taken at `sinceMs` or later, whose tracking
   * result is still to come. Judging keeps windows open for it. Unset, or undefined, when
   * every result is in.
   */
  pendingFrameMs?(sinceMs: number): number | undefined;
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

/** The real input: the webcam, tracked by MediaPipe on the main thread or in the tracking workers. */
export class CameraInput implements GameInput {
  video?: HTMLVideoElement;
  private readonly tracking: CameraTracking;
  /** Stops the camera while it still starts, when the input is disposed. */
  private readonly cameraStart = new AbortController();
  private running = false;
  private disposed = false;
  private videoCallbackId = 0;
  private animationId = 0;
  private lastVideoTime = -1;

  /**
   * With `faces`, the first tracker loads the face models with the hand models.
   * With `worker`, each tracker runs in a tracking worker of its own where it can.
   */
  constructor(mode: TrackerMode, faces: boolean, thread: TrackingThread = 'main') {
    this.tracking = new CameraTracking(mode, faces, thread);
  }

  /** Where the tracker in use runs. */
  get thread(): TrackingThread {
    return this.tracking.current.thread;
  }

  pendingFrameMs(sinceMs: number): number | undefined {
    return this.running ? this.tracking.pendingFrameMs(sinceMs) : undefined;
  }

  get mode(): string {
    return this.tracking.current.mode;
  }

  get delegate(): string {
    return this.tracking.current.delegate;
  }

  get faceDelegate(): string | undefined {
    const { faceDelegate } = this.tracking.current;
    return faceDelegate === 'uninitialized' ? undefined : faceDelegate;
  }

  async init(): Promise<void> {
    // Keep the camera as soon as it starts, so `dispose` can stop it even while the models
    // still load. A dispose while the camera still starts stops it at once.
    const cameraStarted = startCamera(this.cameraStart.signal).then((video) => {
      this.video = video;
      if (this.disposed) this.stopCamera();
    });
    // Wait for both, so a model failure never leaves the camera running.
    const [camera, models] = await Promise.allSettled([cameraStarted, this.tracking.init()]);
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

    const fail = (error: unknown): void => {
      if (!this.running) return;
      this.running = false;
      onError(error);
    };
    // `videoTimeSec` names the camera frame, so a test script can match frames between runs.
    const track = (videoTimeSec: number): void => {
      if (!this.running) return;
      const deliver = (frame: TrackingFrame): void => {
        if (this.running) onFrame({ ...frame, videoTimeSec });
      };
      try {
        this.tracking.track(video, view().faceRegions, deliver, fail);
      } catch (error) {
        fail(error);
      }
    };

    // Track each camera frame once. Chrome tells us when a new frame arrives.
    if (typeof video.requestVideoFrameCallback === 'function') {
      const onVideoFrame = (_nowMs: number, frame: VideoFrameCallbackMetadata): void => {
        track(frame.mediaTime);
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
        track(video.currentTime);
      }
      this.animationId = requestAnimationFrame(onAnimationFrame);
    };
    this.animationId = requestAnimationFrame(onAnimationFrame);
  }

  /** Switches the tracker. See `TrackerSwitch.setMode`. */
  setMode(mode: TrackerMode, faces = false): Promise<void> {
    return this.tracking.setMode(mode, faces);
  }

  dispose(): void {
    this.running = false;
    this.disposed = true;
    this.cameraStart.abort();
    if (this.videoCallbackId) this.video?.cancelVideoFrameCallback(this.videoCallbackId);
    cancelAnimationFrame(this.animationId);
    this.tracking.dispose();
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
    // The bot's misses do not follow the cue set: a test misses the same beats in every set.
    const missSeed = this.options.seed ?? DEFAULT_SEED;
    for (const player of view.players) {
      const tracked = botPlayer(
        view.phase,
        view.songTimeSec,
        player.cues,
        player.grid,
        this.options.botAccuracy,
        missSeed,
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

    const [first, second] = mouseHandPositions(this.pointer.x, view.playerCount, view.phase);
    return [handAt(first), second === null ? { hands: [] } : handAt(second)];
  }

  private onPointerMove = (event: PointerEvent): void => {
    // The simulated camera frame is letterboxed at 16:9, the same as the renderer's default.
    const bounds = this.surface.getBoundingClientRect();
    const frame = containRect(bounds.width, bounds.height, 16 / 9);
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

/**
 * The input the options ask for. A camera starts with `trackerMode`, with or without the face
 * models, on the thread the options ask for.
 */
export function createInput(
  options: Options,
  trackerMode: TrackerMode,
  faces: boolean,
  surface: HTMLElement,
): GameInput {
  return options.input === 'camera'
    ? new CameraInput(trackerMode, faces, options.thread)
    : new SimulatedInput(options, surface);
}
