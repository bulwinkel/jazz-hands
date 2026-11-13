import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tracker, TrackerMode, TrackerOptions } from '../tracking/types';

/** A stand-in tracker whose load the test finishes by hand. */
interface FakeTracker extends Tracker {
  finishLoad: () => void;
}

const { created } = vi.hoisted(() => ({ created: [] as FakeTracker[] }));

vi.mock('../tracking', () => ({
  startCamera: vi.fn(),
  createTracker: (mode: TrackerMode, options: TrackerOptions = {}): FakeTracker => {
    let finishLoad: () => void = () => {};
    let loaded = false;
    const tracker: FakeTracker = {
      mode,
      delegate: 'GPU',
      get faceDelegate() {
        return options.faces && loaded ? 'GPU' : 'uninitialized';
      },
      init: () =>
        new Promise<void>((resolve) => {
          finishLoad = () => {
            loaded = true;
            resolve();
          };
        }),
      finishLoad: () => finishLoad(),
      process: vi.fn(),
      dispose: vi.fn(),
    };
    created.push(tracker);
    return tracker;
  },
}));

const { CameraInput } = await import('./input');

beforeEach(() => {
  created.length = 0;
});

// The rules of switching are tested in src/tracking/trackerSwitch.test.ts. This shows only
// that the camera input goes through the switch.
describe('camera input trackers', () => {
  it('switches to a tracker once it has loaded', async () => {
    const input = new CameraInput('hands-full', false);
    const switching = input.setMode('hands-split');
    expect(input.mode).toBe('hands-full');
    created[1].finishLoad();
    await switching;
    expect(input.mode).toBe('hands-split');
  });
});
