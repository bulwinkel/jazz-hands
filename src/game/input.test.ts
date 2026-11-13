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

describe('camera input trackers', () => {
  it('switches to a tracker once it has loaded', async () => {
    const input = new CameraInput('hands-full', false);
    const switching = input.setMode('hands-split');
    expect(input.mode).toBe('hands-full');
    created[1].finishLoad();
    await switching;
    expect(input.mode).toBe('hands-split');
  });

  it('keeps a newer choice when an older tracker ends its load later', async () => {
    const input = new CameraInput('hands-full', false);
    // A round asks for the split tracker, then the player goes back to the menu at once.
    const slowLoad = input.setMode('hands-split');
    await input.setMode('hands-full');
    created[1].finishLoad();
    await slowLoad;
    expect(input.mode).toBe('hands-full');
    expect(created[1].dispose).not.toHaveBeenCalled();
  });

  it('keeps the late tracker loaded, so a later switch to it needs no load', async () => {
    const input = new CameraInput('hands-full', false);
    const slowLoad = input.setMode('hands-split');
    await input.setMode('hands-full');
    created[1].finishLoad();
    await slowLoad;
    await input.setMode('hands-split');
    expect(input.mode).toBe('hands-split');
    expect(created).toHaveLength(2);
  });

  it('puts a tracker with face models in place of the same tracker without them', async () => {
    const input = new CameraInput('hands-full', false);
    const withFaces = input.setMode('hands-full', true);
    // A newer call for the same tracker without faces is served by the one in use.
    await input.setMode('hands-full', false);
    created[1].finishLoad();
    await withFaces;
    expect(input.faceDelegate).toBe('GPU');
    expect(created[0].dispose).toHaveBeenCalled();
  });
});
