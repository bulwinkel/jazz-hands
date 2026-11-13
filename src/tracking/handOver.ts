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
 * A frame that does not go out is handed back as `dropped`, so that the caller lets it go: a
 * VideoFrame holds camera memory until it is closed.
 *
 * `Tracker` is whatever identifies a tracker; the rule only compares trackers. `Frame` is
 * whatever the caller needs to send a camera frame later.
 */
export class FrameHandOver<Tracker, Frame> {
  /** The frame that is out: its number, the tracker it went to, and the frame. */
  private out?: { number: number; tracker: Tracker; frame: Frame };
  /** The newest camera frame that came while one was out. */
  private held?: Frame;
  private lastNumber = 0;
  private closed = false;

  /**
   * A camera frame came for `tracker`.
   * - No frame is out: `sendAs` is the number to send it under now. Its answer gives it back.
   * - A frame is out: the hand-over holds this frame, and `dropped` is the older held frame
   *   that it takes the place of, if there was one.
   * - After `close`: `dropped` is this frame.
   */
  offer(tracker: Tracker, frame: Frame): { sendAs: number | null; dropped?: Frame } {
    if (this.closed) return { sendAs: null, dropped: frame };
    if (this.out) {
      const dropped = this.held;
      this.held = frame;
      return { sendAs: null, dropped };
    }
    this.lastNumber++;
    this.out = { number: this.lastNumber, tracker, frame };
    return { sendAs: this.lastNumber };
  }

  /**
   * The frames whose answers can still count for `inUse`, oldest first: the frame that is out,
   * when it went to `inUse`, and the held frame, which goes to the tracker in use when it goes.
   */
  waiting(inUse: Tracker): Frame[] {
    const out = this.out?.tracker === inUse ? [this.out.frame] : [];
    return this.held === undefined ? out : [...out, this.held];
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

  /** No frame goes out after this, and no answer counts. Returns the held frame, to let go. */
  close(): Frame | undefined {
    this.closed = true;
    this.out = undefined;
    const held = this.held;
    this.held = undefined;
    return held;
  }
}
