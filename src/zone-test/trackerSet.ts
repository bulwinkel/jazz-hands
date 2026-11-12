import { ZoneTracker } from '../tracking/zones';
import { VARIANTS } from './config';

/**
 * The trackers of one zone count, one for each variant.
 *
 * A tracker loads when it is first asked for and is then kept, so a switch back to a variant
 * is instant. The page keeps the trackers of one zone count only: the four variants of four
 * zones are ten models, and Chrome lets a page have sixteen WebGL contexts, one for each model.
 * A second zone count would not fit beside them.
 */
export class TrackerSet {
  readonly zones: number;
  private readonly loads = new Map<number, Promise<ZoneTracker>>();
  /** Every tracker this set made, loaded or still loading. */
  private readonly trackers: ZoneTracker[] = [];

  constructor(zones: number) {
    this.zones = zones;
  }

  /** The loaded tracker of a variant. `variantIndex` is an index into VARIANTS. */
  load(variantIndex: number): Promise<ZoneTracker> {
    const running = this.loads.get(variantIndex);
    if (running) return running;

    const tracker = new ZoneTracker({ zones: this.zones, ...VARIANTS[variantIndex] });
    this.trackers.push(tracker);
    const load = tracker.init().then(
      () => tracker,
      (error: unknown) => {
        // Forget a failed load, so that asking again tries again.
        this.loads.delete(variantIndex);
        tracker.dispose();
        throw error;
      },
    );
    this.loads.set(variantIndex, load);
    return load;
  }

  /** Closes every tracker. A tracker that is still loading fails its load and is closed too. */
  dispose(): void {
    for (const tracker of this.trackers) tracker.dispose();
    this.trackers.length = 0;
    this.loads.clear();
  }
}
