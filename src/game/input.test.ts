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

const { CameraInput, mouseHandPositions } = await import('./input');

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

describe('the hands of the mouse input', () => {
  it('is one hand at the pointer for one player', () => {
    expect(mouseHandPositions(0.8, 1, 'results')).toEqual([0.8, null]);
  });

  it('folds the pointer into the left half and mirrors it for two players in a round', () => {
    expect(mouseHandPositions(0.8, 2, 'results')).toEqual([expect.closeTo(0.2), expect.closeTo(0.8)]);
    expect(mouseHandPositions(0.3, 2, 'ready')).toEqual([expect.closeTo(0.3), expect.closeTo(0.7)]);
  });

  it('is one hand at the pointer in the menu, where each player has a pointer of their own', () => {
    expect(mouseHandPositions(0.8, 2, 'menu')).toEqual([0.8, null]);
  });
});
