import { describe, expect, it } from 'vitest';
import { FrameHandOver } from './handOver';

/** Camera frames by their number, for the test to follow. */
const handOver = () => new FrameHandOver<string, number>();

describe('handing camera frames to the worker', () => {
  it('sends a frame when none is out', () => {
    expect(handOver().offer('hands-full', 1)).toEqual({ sendAs: 1 });
  });

  it('holds a frame that comes while one is out, and sends nothing more', () => {
    const frames = handOver();
    frames.offer('hands-full', 1);
    expect(frames.offer('hands-full', 2)).toEqual({ sendAs: null, dropped: undefined });
  });

  it('holds only the newest frame, and hands back each older one to let go', () => {
    const frames = handOver();
    const { sendAs: first } = frames.offer('hands-full', 1);
    frames.offer('hands-full', 2);
    expect(frames.offer('hands-full', 3).dropped).toBe(2);
    expect(frames.offer('hands-full', 4).dropped).toBe(3);
    expect(frames.settle(first as number, 'hands-full').next).toBe(4);
  });

  it('frees the way for the held frame once the answer is in', () => {
    const frames = handOver();
    const { sendAs: first } = frames.offer('hands-full', 1);
    frames.offer('hands-full', 2);
    const { next } = frames.settle(first as number, 'hands-full');
    expect(frames.offer('hands-full', next as number)).toEqual({ sendAs: (first as number) + 1 });
  });

  it('has no next frame when none came while one was out', () => {
    const frames = handOver();
    const { sendAs } = frames.offer('hands-full', 1);
    expect(frames.settle(sendAs as number, 'hands-full')).toEqual({ counts: true, next: undefined });
  });

  it('passes on a failure the same way as a result', () => {
    // The caller settles a failure like a result, and reports it only when it counts.
    const frames = handOver();
    const { sendAs } = frames.offer('hands-split', 1);
    expect(frames.settle(sendAs as number, 'hands-split').counts).toBe(true);
    expect(frames.offer('hands-split', 2).sendAs).not.toBeNull();
  });
});

describe('the latest tracker wins', () => {
  it('drops the answer of a tracker that was switched away while its frame was out', () => {
    const frames = handOver();
    const { sendAs } = frames.offer('hands-full', 1);
    expect(frames.settle(sendAs as number, 'hands-split').counts).toBe(false);
  });

  it('still hands over the held frame, for the new tracker', () => {
    const frames = handOver();
    const { sendAs: old } = frames.offer('hands-full', 1);
    frames.offer('hands-split', 2);
    const { next } = frames.settle(old as number, 'hands-split');
    const { sendAs } = frames.offer('hands-split', next as number);
    expect(frames.settle(sendAs as number, 'hands-split').counts).toBe(true);
  });

  it('compares trackers, not modes: a new tracker of the same mode is another tracker', () => {
    const withoutFaces = { mode: 'hands-full' };
    const withFaces = { mode: 'hands-full' };
    const frames = new FrameHandOver<object, number>();
    const { sendAs } = frames.offer(withoutFaces, 1);
    expect(frames.settle(sendAs as number, withFaces).counts).toBe(false);
  });
});

describe('the frames whose answers are still to come', () => {
  it('are the frame that is out and the held frame, oldest first', () => {
    const frames = handOver();
    frames.offer('hands-full', 1);
    frames.offer('hands-full', 2);
    expect(frames.waiting('hands-full')).toEqual([1, 2]);
  });

  it('leave out the frame that went to a tracker no longer in use', () => {
    const frames = handOver();
    frames.offer('hands-full', 1);
    frames.offer('hands-split', 2);
    expect(frames.waiting('hands-split')).toEqual([2]);
  });

  it('are none when every answer is in', () => {
    const frames = handOver();
    const { sendAs } = frames.offer('hands-full', 1);
    frames.settle(sendAs as number, 'hands-full');
    expect(frames.waiting('hands-full')).toEqual([]);
  });
});

describe('closing the hand-over', () => {
  it('drops the answer of the frame that was out, and hands back the held frame to let go', () => {
    const frames = handOver();
    const { sendAs } = frames.offer('hands-full', 1);
    frames.offer('hands-full', 2);
    expect(frames.close()).toBe(2);
    expect(frames.settle(sendAs as number, 'hands-full')).toEqual({ counts: false });
  });

  it('hands back every frame offered after it is closed, and sends none', () => {
    const frames = handOver();
    frames.close();
    expect(frames.offer('hands-full', 1)).toEqual({ sendAs: null, dropped: 1 });
  });
});

describe('answers that do not belong to the frame that is out', () => {
  it('ignores a second answer to the same frame', () => {
    const frames = handOver();
    const { sendAs: first } = frames.offer('hands-full', 1);
    frames.settle(first as number, 'hands-full');
    const { sendAs: second } = frames.offer('hands-full', 2);
    frames.offer('hands-full', 3);
    expect(frames.settle(first as number, 'hands-full')).toEqual({ counts: false });
    expect(frames.settle(second as number, 'hands-full')).toEqual({ counts: true, next: 3 });
  });
});
