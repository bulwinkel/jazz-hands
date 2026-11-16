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

const { CameraInput, mouseHandPositions, mouseHands } = await import('./input');
const { CALIBRATE_CELL, START_CELL } = await import('./config');
const { cellCentre, cellRect, defaultGrid, insideCell } = await import('./geometry');

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

  it('puts one hand at the pointer and a copy half a frame away for two players in a round', () => {
    expect(mouseHandPositions(0.8, 2, 'results')).toEqual([expect.closeTo(0.3), expect.closeTo(0.8)]);
    expect(mouseHandPositions(0.3, 2, 'ready')).toEqual([expect.closeTo(0.3), expect.closeTo(0.8)]);
  });

  it.each([
    ['the left player', 0],
    ['the right player', 1],
  ] as const)('holds the Start cell of both players from the Start cell of %s, not a Calibrate cell', (_, index) => {
    const pointer = cellCentre(defaultGrid(index, 2), START_CELL);
    const hands = mouseHands(pointer, 'open', 2, 'ready');
    for (const player of [0, 1] as const) {
      const [hand] = hands[player].hands;
      const grid = defaultGrid(player, 2);
      expect(insideCell(hand, cellRect(grid, START_CELL))).toBe(true);
      expect(insideCell(hand, cellRect(grid, CALIBRATE_CELL))).toBe(false);
    }
  });

  it('keeps the copy open on the results, so only the hand at the pointer chooses', () => {
    const [left, right] = mouseHands({ x: 0.7, y: 0.5 }, 'fist', 2, 'results');
    expect(right.hands[0]).toMatchObject({ x: 0.7, gesture: 'fist' });
    expect(left.hands[0].gesture).toBe('open');
    const [pointerHand, copy] = mouseHands({ x: 0.2, y: 0.5 }, 'fist', 2, 'results');
    expect(pointerHand.hands[0]).toMatchObject({ x: 0.2, gesture: 'fist' });
    expect(copy.hands[0].gesture).toBe('open');
  });

  it('gives the copy the shape of the held key in a round, for the hand shapes of both charts', () => {
    const [left, right] = mouseHands({ x: 0.2, y: 0.5 }, 'peace', 2, 'play');
    expect([left.hands[0].gesture, right.hands[0].gesture]).toEqual(['peace', 'peace']);
  });

  it('is one hand at the pointer in the menu, where each player has a pointer of their own', () => {
    expect(mouseHandPositions(0.8, 2, 'menu')).toEqual([0.8, null]);
  });
});
