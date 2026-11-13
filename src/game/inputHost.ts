import type { TrackerMode, TrackingFrame } from '../tracking/types';
import { DEFAULT_TRACKER } from './config';
import { createInput } from './input';
import type { GameInput, InputView } from './input';
import type { Options } from './settings';

/** An input with this tracker, with or without the face models. */
export interface InputNeeds {
  mode: TrackerMode;
  faces: boolean;
}

/** What the game wants from the input: none, or one with these needs. */
export type InputWish = InputNeeds | null;

/** The trackers the M key steps through. */
const TRACKER_CYCLE: readonly TrackerMode[] = ['hands-full', 'hands-split', 'pose'];

/** The tracker after `mode` for the M key. After the last comes the first. */
export function nextTracker(mode: TrackerMode): TrackerMode {
  return TRACKER_CYCLE[(TRACKER_CYCLE.indexOf(mode) + 1) % TRACKER_CYCLE.length];
}

/** What the host tells the game. */
export interface InputHooks {
  /** What the input needs to know about the game, read on every frame. */
  view: () => InputView;
  onFrame: (frame: TrackingFrame) => void;
  /** Tracking broke while it ran. The host has closed the input by then. */
  onFailure: (error: unknown) => void;
}

/**
 * Opens, switches and closes the camera, or a test input, as the game asks. The game only
 * says what it wants. A camera takes seconds to open, and by then the game may want something
 * else, so after every wait the host acts on the latest wish.
 */
export class InputHost {
  private readonly options: Options;
  /** The element the camera picture goes into. */
  private readonly surface: HTMLElement;
  private readonly hooks: InputHooks;
  private readonly create: typeof createInput;
  private current?: GameInput;
  private lastError?: unknown;
  private wish: InputWish = null;
  /** Set while an input opens, so two wishes share one opening. */
  private opening?: Promise<void>;
  /** The input of that opening, so a close can stop its camera before its models have loaded. */
  private openingInput?: GameInput;
  /** Goes up each time the input closes, so an opening that ends later can tell that nobody wants it. */
  private closings = 0;
  /** Tracker picked with the M key. It lasts until the page reloads. */
  private pickedTracker?: TrackerMode;

  /** `create` makes the input. Tests give a stand-in. */
  constructor(options: Options, surface: HTMLElement, hooks: InputHooks, create = createInput) {
    this.options = options;
    this.surface = surface;
    this.hooks = hooks;
    this.create = create;
  }

  /** The open input. Unset while none is open. */
  get input(): GameInput | undefined {
    return this.current;
  }

  /** Why the input could not start, or why tracking broke, when it did. */
  get error(): unknown {
    return this.lastError;
  }

  /** The tracker for a round: the one picked with the M key, else the URL's, else the default for the player count. */
  trackerMode(): TrackerMode {
    return this.pickedTracker ?? this.options.tracker ?? DEFAULT_TRACKER[this.options.settings.playerCount];
  }

  /**
   * Makes the input match `wish`: opens it, switches its tracker, or closes it.
   * Resolves when that is done, when a newer wish took over, and also when the input could
   * not start: `error` then says why. Rejects when a tracker fails to load.
   */
  async want(wish: InputWish): Promise<void> {
    this.wish = wish;
    if (!wish) {
      this.close();
      return;
    }
    if (!this.current) await this.open(wish);
    // A newer wish does its own work.
    if (this.wish !== wish || !this.current) return;
    await this.current.setMode(wish.mode, wish.faces);
  }

  /** M key: loads the next tracker and keeps it for later rounds. */
  async pickNextTracker(faces: boolean): Promise<void> {
    const wish = { mode: nextTracker(this.trackerMode()), faces };
    await this.want(wish);
    if (this.wish === wish && this.current) this.pickedTracker = wish.mode;
  }

  dispose(): void {
    void this.want(null);
  }

  private open(needs: InputNeeds): Promise<void> {
    if (!this.opening) {
      const opening = this.connect(needs).finally(() => {
        if (this.opening === opening) this.opening = undefined;
      });
      this.opening = opening;
    }
    return this.opening;
  }

  /**
   * Opens an input with the tracker and the face models of `needs`, so it loads its models
   * once, and starts tracking.
   */
  private async connect(needs: InputNeeds): Promise<void> {
    const closings = this.closings;
    const input = this.create(this.options, needs.mode, needs.faces, this.surface);
    this.openingInput = input;
    try {
      await input.init();
    } catch (error) {
      input.dispose();
      if (closings === this.closings) this.lastError = error;
      return;
    } finally {
      if (this.openingInput === input) this.openingInput = undefined;
    }
    // The input closed while this one opened: nobody wants it now. A newer wish has an opening
    // of its own. The close has disposed this input already; disposing again does no harm.
    if (closings !== this.closings) {
      input.dispose();
      return;
    }
    this.lastError = undefined;
    this.current = input;
    if (input.video) this.surface.prepend(input.video);
    input.start(this.hooks.view, this.hooks.onFrame, (error) => this.onTrackingFailure(input, error));
  }

  /**
   * Releases the camera and its trackers, also those of an input that still opens: its camera
   * light goes out now, not when its models have loaded.
   */
  private close(): void {
    this.closings++;
    this.opening = undefined;
    this.openingInput?.dispose();
    this.openingInput = undefined;
    this.current?.dispose();
    this.current = undefined;
  }

  private onTrackingFailure(input: GameInput, error: unknown): void {
    if (input !== this.current) return;
    this.close();
    this.lastError = error;
    this.hooks.onFailure(error);
  }
}
