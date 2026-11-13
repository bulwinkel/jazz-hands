import type { TrackingFrame } from './types';
import type { WorkerAnswer, WorkerRequest } from './workerProtocol';

/**
 * Stand-ins for the browser's Worker and VideoFrame, for tests of the tracking workers. Install
 * them with `vi.stubGlobal('Worker', FakeWorker)` and `vi.stubGlobal('VideoFrame', FakeVideoFrame)`.
 */

type Listener = (event: { data?: WorkerAnswer; message?: string; preventDefault?: () => void }) => void;

/** A stand-in for the browser's Worker. The test answers for the worker by hand. */
export class FakeWorker {
  static made: FakeWorker[] = [];
  /** Set to make the next workers throw when they are made, as in a browser that cannot. */
  static failToStart = false;
  readonly options: WorkerOptions;
  readonly posted: { request: WorkerRequest; transfer: Transferable[] }[] = [];
  private readonly listeners = new Map<string, Listener[]>();
  terminated = false;

  constructor(_url: URL, options: WorkerOptions) {
    if (FakeWorker.failToStart) throw new Error('No workers here.');
    this.options = options;
    FakeWorker.made.push(this);
  }

  static get last(): FakeWorker {
    return FakeWorker.made[FakeWorker.made.length - 1];
  }

  static reset(): void {
    FakeWorker.made = [];
    FakeWorker.failToStart = false;
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  postMessage(request: WorkerRequest, transfer: Transferable[] = []): void {
    for (const item of transfer) if (item instanceof FakeVideoFrame) item.transfers++;
    this.posted.push({ request, transfer });
  }

  terminate(): void {
    this.terminated = true;
  }

  answer(answer: WorkerAnswer): void {
    for (const listener of this.listeners.get('message') ?? []) listener({ data: answer });
  }

  /** Answers the last frame it got with no hands, at the time the page gave that frame. */
  answerLastFrame(): void {
    const request = this.posted.findLast((posted) => posted.request.type === 'track')?.request;
    if (request?.type !== 'track') throw new Error('No frame was sent to this worker.');
    this.answer({ type: 'tracked', frame: request.frame, result: emptyFrame(request.timeMs) });
  }

  /** The frames it got, in order. */
  frames(): Extract<WorkerRequest, { type: 'track' }>[] {
    return this.posted.flatMap((posted) => (posted.request.type === 'track' ? [posted.request] : []));
  }

  breakDown(message: string): void {
    for (const listener of this.listeners.get('error') ?? []) listener({ message, preventDefault: () => {} });
  }
}

/**
 * A stand-in for VideoFrame that counts how its camera memory is let go: closed on the page,
 * or transferred to a worker, which closes it there. Each frame must be let go exactly once.
 */
export class FakeVideoFrame {
  static made: FakeVideoFrame[] = [];
  /** The picture the source showed when this frame was made: a `FakeVideo`'s `picture`. */
  readonly shows: number | undefined;
  closes = 0;
  transfers = 0;

  constructor(source?: FakeVideo) {
    this.shows = source?.picture;
    FakeVideoFrame.made.push(this);
  }

  close(): void {
    this.closes++;
  }

  /** How often it was let go. Exactly once is right. */
  get releases(): number {
    return this.closes + this.transfers;
  }
}

/** A stand-in for the video element. The test moves `picture` on, as the camera does. */
export interface FakeVideo {
  picture: number;
}

export function emptyFrame(timeMs: number): TrackingFrame {
  return { timeMs, inferenceMs: 12, players: [{ hands: [] }, { hands: [] }] };
}
