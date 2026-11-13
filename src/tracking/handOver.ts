/**
 * The rule for handing camera frames to the tracking worker.
 *
 * - At most one frame is out at a time. A camera frame that comes while one is out is dropped,
 *   never queued: a queue would only add delay, and the game wants the newest hands.
 * - An answer counts only when the tracker that made it is still the tracker in use. After a
 *   switch, the game gets frames from the new tracker only, as it does on the main thread.
 * - After `close`, no frame goes out and no answer counts.
 *
 * `Tracker` is whatever identifies a tracker. The rule only compares trackers.
 */
export class FrameHandOver<Tracker> {
  /** The frame that is out: its number, and the tracker it went to. */
  private out?: { number: number; tracker: Tracker };
  private lastNumber = 0;
  private closed = false;

  /** True while a frame is out. */
  get busy(): boolean {
    return this.out !== undefined;
  }

  /**
   * Lets a camera frame go to `tracker`. Returns the frame's number, which its answer must
   * give back. Returns null when the frame must be dropped: one is out already, or the
   * hand-over is closed.
   */
  send(tracker: Tracker): number | null {
    if (this.closed || this.out) return null;
    this.lastNumber++;
    this.out = { number: this.lastNumber, tracker };
    return this.lastNumber;
  }

  /**
   * The answer to frame `number` came: a result or a failure. It frees the way for the next
   * frame. Returns true when the game must get the answer: the hand-over is open, and the
   * tracker of the frame is `inUse`.
   */
  settle(number: number, inUse: Tracker): boolean {
    if (this.out?.number !== number) return false;
    const { tracker } = this.out;
    this.out = undefined;
    return !this.closed && tracker === inUse;
  }

  /** No frame goes out after this, and no answer counts. */
  close(): void {
    this.closed = true;
    this.out = undefined;
  }
}
