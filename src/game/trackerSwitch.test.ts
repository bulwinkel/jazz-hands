import { describe, expect, it, vi } from 'vitest';
import type { TrackerMode } from '../tracking/types';
import { TrackerSwitch } from './trackerSwitch';
import type { SwitchableTracker } from './trackerSwitch';

/** A stand-in tracker whose load the test finishes by hand. */
interface FakeTracker extends SwitchableTracker {
  finishLoad: () => void;
  failLoad: (error: Error) => void;
  dispose: ReturnType<typeof vi.fn<() => void>>;
}

function fakeTrackers() {
  const created: FakeTracker[] = [];
  const create = (mode: TrackerMode, faces: boolean): FakeTracker => {
    let loaded = false;
    let finish: () => void = () => {};
    let fail: (error: Error) => void = () => {};
    const load = new Promise<void>((resolve, reject) => {
      finish = () => {
        loaded = true;
        resolve();
      };
      fail = reject;
    });
    const tracker: FakeTracker = {
      mode,
      get faceDelegate() {
        return faces && loaded ? 'GPU' : 'uninitialized';
      },
      init: () => load,
      finishLoad: () => finish(),
      failLoad: (error) => fail(error),
      dispose: vi.fn<() => void>(),
    };
    created.push(tracker);
    return tracker;
  };
  return { created, create };
}

describe('switching trackers', () => {
  it('uses the first tracker at once', () => {
    const { create, created } = fakeTrackers();
    const trackers = new TrackerSwitch(create, 'hands-full', false);
    expect(trackers.current).toBe(created[0]);
  });

  it('switches only once the new tracker has loaded', async () => {
    const { create, created } = fakeTrackers();
    const trackers = new TrackerSwitch(create, 'hands-full', false);
    const switching = trackers.setMode('hands-split');
    expect(trackers.current.mode).toBe('hands-full');
    created[1].finishLoad();
    await switching;
    expect(trackers.current.mode).toBe('hands-split');
  });

  it('switches back to a loaded mode with no new load', async () => {
    const { create, created } = fakeTrackers();
    const trackers = new TrackerSwitch(create, 'hands-full', false);
    const switching = trackers.setMode('hands-split');
    created[1].finishLoad();
    await switching;
    await trackers.setMode('hands-full');
    expect(trackers.current).toBe(created[0]);
    expect(created).toHaveLength(2);
  });

  it('keeps the tracker in use when a new one fails to load, and frees the failed one', async () => {
    const { create, created } = fakeTrackers();
    const trackers = new TrackerSwitch(create, 'hands-full', false);
    const switching = trackers.setMode('pose');
    created[1].failLoad(new Error('No model.'));
    await expect(switching).rejects.toThrow('No model.');
    expect(trackers.current).toBe(created[0]);
    expect(created[1].dispose).toHaveBeenCalled();
  });
});

describe('the latest call wins', () => {
  it('keeps a newer choice when an older load ends later', async () => {
    const { create, created } = fakeTrackers();
    const trackers = new TrackerSwitch(create, 'hands-full', false);
    const slowLoad = trackers.setMode('hands-split');
    await trackers.setMode('hands-full');
    created[1].finishLoad();
    await slowLoad;
    expect(trackers.current.mode).toBe('hands-full');
    expect(created[1].dispose).not.toHaveBeenCalled();
  });

  it('puts a tracker with face models in place of the same tracker without them', async () => {
    const { create, created } = fakeTrackers();
    const trackers = new TrackerSwitch(create, 'hands-full', false);
    const withFaces = trackers.setMode('hands-full', true);
    await trackers.setMode('hands-full', false);
    created[1].finishLoad();
    await withFaces;
    expect(trackers.current).toBe(created[1]);
    expect(created[0].dispose).toHaveBeenCalled();
  });
});

describe('disposing the trackers', () => {
  it('disposes every loaded tracker', async () => {
    const { create, created } = fakeTrackers();
    const trackers = new TrackerSwitch(create, 'hands-full', false);
    const switching = trackers.setMode('hands-split');
    created[1].finishLoad();
    await switching;
    trackers.dispose();
    expect(created[0].dispose).toHaveBeenCalled();
    expect(created[1].dispose).toHaveBeenCalled();
  });

  it('disposes a tracker whose load ends after the dispose', async () => {
    const { create, created } = fakeTrackers();
    const trackers = new TrackerSwitch(create, 'hands-full', false);
    const switching = trackers.setMode('pose');
    trackers.dispose();
    created[1].finishLoad();
    await switching;
    expect(created[1].dispose).toHaveBeenCalled();
    expect(trackers.current).toBe(created[0]);
  });
});
