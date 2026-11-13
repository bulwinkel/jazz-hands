import type { TrackerDelegate, TrackerMode } from '../tracking/types';

/** What the switch needs of a tracker. A tracker on the page and one in the worker both have it. */
export interface SwitchableTracker {
  readonly mode: TrackerMode;
  /** 'uninitialized' while the tracker has no face models. */
  readonly faceDelegate: TrackerDelegate;
  init(): Promise<void>;
  dispose(): void;
}

/**
 * The trackers a camera input has loaded, and the one in use. A mode loads once and is then
 * kept, because the menu and the rounds switch between modes often.
 */
export class TrackerSwitch<Tracker extends SwitchableTracker> {
  private readonly create: (mode: TrackerMode, faces: boolean) => Tracker;
  private readonly loaded = new Map<TrackerMode, Tracker>();
  private inUse: Tracker;
  /** Counts the calls of `setMode`, so a load that ends late can tell that a newer call came. */
  private modeCalls = 0;
  private disposed = false;

  /** The first tracker is in use at once. It loads with `current.init()`. */
  constructor(create: (mode: TrackerMode, faces: boolean) => Tracker, mode: TrackerMode, faces: boolean) {
    this.create = create;
    this.inUse = create(mode, faces);
    this.loaded.set(mode, this.inUse);
  }

  get current(): Tracker {
    return this.inUse;
  }

  /**
   * Switches the tracker. The switch happens only after the new tracker has loaded, so
   * tracking never stops on a failure.
   *
   * With `faces`, the tracker must have the face models. The menu loads its tracker before
   * anyone has chosen faces, so a mode that was loaded without them loads once more, with them.
   * A tracker with the face models also serves a round without faces: it reads a face only
   * where the game asks for one.
   *
   * A load can end after a newer call has switched to another tracker. The loaded tracker then
   * stays in the cache, and the newer choice stays on.
   */
  async setMode(mode: TrackerMode, faces = false): Promise<void> {
    const call = ++this.modeCalls;
    const loaded = this.loaded.get(mode);
    const isUsable = loaded !== undefined && (!faces || loaded.faceDelegate !== 'uninitialized');
    if (isUsable) {
      this.inUse = loaded;
      return;
    }

    const next = this.create(mode, faces);
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
    const replaced = this.loaded.get(mode);
    this.loaded.set(mode, next);
    // A tracker that only adds the face models to the one in use takes its place in any case:
    // it serves the same mode, and the one without faces is let go.
    if (call === this.modeCalls || this.inUse === replaced) this.inUse = next;
    if (replaced && replaced !== this.inUse) replaced.dispose();
  }

  /** Disposes every loaded tracker. A load that ends later is disposed too. */
  dispose(): void {
    this.disposed = true;
    for (const tracker of this.loaded.values()) tracker.dispose();
  }
}
