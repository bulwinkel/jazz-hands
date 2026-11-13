import { describe, expect, it } from 'vitest';
import { FrameHandOver } from './handOver';

describe('handing camera frames to the worker', () => {
  it('sends a frame when none is out', () => {
    const handOver = new FrameHandOver<string>();
    expect(handOver.send('hands-full')).toBe(1);
    expect(handOver.busy).toBe(true);
  });

  it('drops every frame that comes while one is out', () => {
    const handOver = new FrameHandOver<string>();
    handOver.send('hands-full');
    expect(handOver.send('hands-full')).toBeNull();
    expect(handOver.send('hands-full')).toBeNull();
  });

  it('never queues a dropped frame: after the answer, only the next new frame goes out', () => {
    const handOver = new FrameHandOver<string>();
    const first = handOver.send('hands-full') as number;
    handOver.send('hands-full');
    handOver.send('hands-full');
    handOver.settle(first, 'hands-full');
    expect(handOver.busy).toBe(false);
    expect(handOver.send('hands-full')).toBe(first + 1);
  });

  it('passes on the answer from the tracker in use', () => {
    const handOver = new FrameHandOver<string>();
    const frame = handOver.send('hands-full') as number;
    expect(handOver.settle(frame, 'hands-full')).toBe(true);
  });

  it('passes on a failure the same way as a result', () => {
    // The caller settles a failure like a result, and reports it only when it counts.
    const handOver = new FrameHandOver<string>();
    const frame = handOver.send('hands-split') as number;
    expect(handOver.settle(frame, 'hands-split')).toBe(true);
    expect(handOver.busy).toBe(false);
  });
});

describe('the latest tracker wins', () => {
  it('drops the answer of a tracker that was switched away while its frame was out', () => {
    const handOver = new FrameHandOver<string>();
    const frame = handOver.send('hands-full') as number;
    expect(handOver.settle(frame, 'hands-split')).toBe(false);
  });

  it('frees the way for the new tracker once the old answer is in', () => {
    const handOver = new FrameHandOver<string>();
    const old = handOver.send('hands-full') as number;
    expect(handOver.send('hands-split')).toBeNull();
    handOver.settle(old, 'hands-split');
    const next = handOver.send('hands-split') as number;
    expect(handOver.settle(next, 'hands-split')).toBe(true);
  });

  it('compares trackers, not modes: a new tracker of the same mode is another tracker', () => {
    const withoutFaces = { mode: 'hands-full' };
    const withFaces = { mode: 'hands-full' };
    const handOver = new FrameHandOver<object>();
    const frame = handOver.send(withoutFaces) as number;
    expect(handOver.settle(frame, withFaces)).toBe(false);
  });
});

describe('closing the hand-over', () => {
  it('drops the answer of the frame that was out', () => {
    const handOver = new FrameHandOver<string>();
    const frame = handOver.send('hands-full') as number;
    handOver.close();
    expect(handOver.settle(frame, 'hands-full')).toBe(false);
  });

  it('sends no frame after it is closed', () => {
    const handOver = new FrameHandOver<string>();
    handOver.close();
    expect(handOver.send('hands-full')).toBeNull();
    expect(handOver.busy).toBe(false);
  });
});

describe('answers that do not belong to the frame that is out', () => {
  it('ignores a second answer to the same frame', () => {
    const handOver = new FrameHandOver<string>();
    const first = handOver.send('hands-full') as number;
    handOver.settle(first, 'hands-full');
    const second = handOver.send('hands-full') as number;
    expect(handOver.settle(first, 'hands-full')).toBe(false);
    expect(handOver.busy).toBe(true);
    expect(handOver.settle(second, 'hands-full')).toBe(true);
  });
});
