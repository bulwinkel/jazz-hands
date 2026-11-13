import { describe, expect, it } from 'vitest';
import { FrameHandOver } from './handOver';

/** Camera frames by their number, for the test to follow. */
const handOver = () => new FrameHandOver<string, number>();

describe('handing camera frames to the worker', () => {
  it('sends a frame when none is out', () => {
    const frames = handOver();
    expect(frames.offer('hands-full', 1)).toBe(1);
    expect(frames.busy).toBe(true);
  });

  it('holds a frame that comes while one is out, and sends nothing more', () => {
    const frames = handOver();
    frames.offer('hands-full', 1);
    expect(frames.offer('hands-full', 2)).toBeNull();
    expect(frames.busy).toBe(true);
  });

  it('holds only the newest frame: an older held frame is dropped, never queued', () => {
    const frames = handOver();
    const first = frames.offer('hands-full', 1) as number;
    frames.offer('hands-full', 2);
    frames.offer('hands-full', 3);
    frames.offer('hands-full', 4);
    expect(frames.settle(first, 'hands-full').next).toBe(4);
  });

  it('frees the way for the held frame once the answer is in', () => {
    const frames = handOver();
    const first = frames.offer('hands-full', 1) as number;
    frames.offer('hands-full', 2);
    const { next } = frames.settle(first, 'hands-full');
    expect(frames.busy).toBe(false);
    expect(frames.offer('hands-full', next as number)).toBe(first + 1);
  });

  it('has no next frame when none came while one was out', () => {
    const frames = handOver();
    const first = frames.offer('hands-full', 1) as number;
    expect(frames.settle(first, 'hands-full')).toEqual({ counts: true, next: undefined });
  });

  it('passes on a failure the same way as a result', () => {
    // The caller settles a failure like a result, and reports it only when it counts.
    const frames = handOver();
    const number = frames.offer('hands-split', 1) as number;
    expect(frames.settle(number, 'hands-split').counts).toBe(true);
    expect(frames.busy).toBe(false);
  });
});

describe('the latest tracker wins', () => {
  it('drops the answer of a tracker that was switched away while its frame was out', () => {
    const frames = handOver();
    const number = frames.offer('hands-full', 1) as number;
    expect(frames.settle(number, 'hands-split').counts).toBe(false);
  });

  it('still hands over the held frame, for the new tracker', () => {
    const frames = handOver();
    const old = frames.offer('hands-full', 1) as number;
    frames.offer('hands-split', 2);
    const { next } = frames.settle(old, 'hands-split');
    const number = frames.offer('hands-split', next as number) as number;
    expect(frames.settle(number, 'hands-split').counts).toBe(true);
  });

  it('compares trackers, not modes: a new tracker of the same mode is another tracker', () => {
    const withoutFaces = { mode: 'hands-full' };
    const withFaces = { mode: 'hands-full' };
    const frames = new FrameHandOver<object, number>();
    const number = frames.offer(withoutFaces, 1) as number;
    expect(frames.settle(number, withFaces).counts).toBe(false);
  });
});

describe('closing the hand-over', () => {
  it('drops the answer of the frame that was out, and the held frame', () => {
    const frames = handOver();
    const number = frames.offer('hands-full', 1) as number;
    frames.offer('hands-full', 2);
    frames.close();
    expect(frames.settle(number, 'hands-full')).toEqual({ counts: false });
  });

  it('sends and holds no frame after it is closed', () => {
    const frames = handOver();
    frames.close();
    expect(frames.offer('hands-full', 1)).toBeNull();
    expect(frames.busy).toBe(false);
  });
});

describe('answers that do not belong to the frame that is out', () => {
  it('ignores a second answer to the same frame', () => {
    const frames = handOver();
    const first = frames.offer('hands-full', 1) as number;
    frames.settle(first, 'hands-full');
    const second = frames.offer('hands-full', 2) as number;
    frames.offer('hands-full', 3);
    expect(frames.settle(first, 'hands-full')).toEqual({ counts: false });
    expect(frames.busy).toBe(true);
    expect(frames.settle(second, 'hands-full')).toEqual({ counts: true, next: 3 });
  });
});
