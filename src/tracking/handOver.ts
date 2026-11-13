/**
 * The rule for handing camera frames to a tracking worker.
 *
 * - At most one frame is out at a time.
 * - A camera frame that comes while one is out is held, and a newer one takes its place: only
 *   the newest frame ever waits, so nothing queues behind it and no delay builds up. When the
 *   answer comes, the held frame goes out at once. Without it, the worker would sit idle until
 *   the next camera frame: with two hands tracked, that cost a third of the tracked frames.
 * - An answer counts only when the tracker that made it is still the tracker in use. After a
 *   switch, the game gets frames from the new tracker only, as it does on the main thread.
 * - After `close`, no frame goes out, none is held, and no answer counts.
 *
 * `Tracker` is whatever identifies a tracker; the rule only compares trackers. `Frame` is
 * whatever the caller needs to send a camera frame later.
 */
export class FrameHandOver<Tracker, Frame> {
  /** The frame that is out: its number, and the tracker it went to. */
  private out?: { number: number; tracker: Tracker };
  /** The newest camera frame that came while one was out. */
  private held?: Frame;
  private lastNumber = 0;
  private closed = false;

  /** True while a frame is out. */
  get busy(): boolean {
    return this.out !== undefined;
  }

  /**
   * A camera frame came for `tracker`. Returns the number to send it under now, which its
   * answer must give back. Returns null when it must not go now: it is held while a frame is
   * out, and dropped after `close`.
   */
  offer(tracker: Tracker, frame: Frame): number | null {
    if (this.closed) return null;
    if (this.out) {
      this.held = frame;
      return null;
    }
    this.lastNumber++;
    this.out = { number: this.lastNumber, tracker };
    return this.lastNumber;
  }

  /**
   * The answer to frame `number` came: a result or a failure. It frees the way for the next
   * frame. `counts` is true when the game must get the answer: the hand-over is open, and the
   * tracker of the frame is `inUse`. `next` is the held frame, to offer at once.
   */
  settle(number: number, inUse: Tracker): { counts: boolean; next?: Frame } {
    if (this.out?.number !== number) return { counts: false };
    const { tracker } = this.out;
    this.out = undefined;
    const next = this.held;
    this.held = undefined;
    return { counts: !this.closed && tracker === inUse, next };
  }

  /** No frame goes out after this, none is held, and no answer counts. */
  close(): void {
    this.closed = true;
    this.out = undefined;
    this.held = undefined;
  }
}
