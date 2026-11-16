import { describe, expect, it } from 'vitest';
import type { TrackedHand, TrackingFrame } from '../tracking/types';
import {
  addReach,
  beginReach,
  circlesMessage,
  finishReach,
  gridNotChangedText,
  KeptGrids,
  startOnKeptGrids,
} from './calibration';
import type { CalibratedPlayer } from './calibration';
import { GRID } from './config';
import { defaultGrid } from './geometry';
import { createPlayers } from './player';
import { parseSettings } from './settings';
import type { PlayerCount, PlayerIndex, Point, Rect } from './types';

function players(count: PlayerCount): CalibratedPlayer[] {
  return createPlayers(parseSettings(null, `?players=${count}`).settings);
}

/** Hand positions on an ellipse around `centre`, more than enough to fit a grid to. */
function ellipse(centre: Point, radiusX: number, radiusY: number): Point[] {
  return Array.from({ length: GRID.fitMinSamples * 2 }, (_, i) => {
    const angle = (i / GRID.fitMinSamples) * Math.PI;
    return { x: centre.x + Math.cos(angle) * radiusX, y: centre.y + Math.sin(angle) * radiusY };
  });
}

/** Big circles of the left player of two, or of one player: a reach that counts. */
const BIG_LEFT = ellipse({ x: 0.25, y: 0.5 }, 0.13, 0.25);
/** Big circles of the right player of two. */
const BIG_RIGHT = ellipse({ x: 0.75, y: 0.5 }, 0.15, 0.3);
/** A player who stands still: many hand positions, but no reach. */
const STILL = ellipse({ x: 0.25, y: 0.5 }, 0.01, 0.01);

/** A grid that only a calibration gives: the standard grid is never this. */
const CALIBRATED_GRID: Rect = { x: 0.1, y: 0.25, width: 0.3, height: 0.6 };

/** A tracking frame with these hands for the left player, or the only player, and these for the right player. */
function frameWith(left: readonly Point[], right: readonly Point[] = []): TrackingFrame {
  const hand = (point: Point): TrackedHand => ({ ...point, size: 0.05, gesture: 'open', gestureScore: 1 });
  return { timeMs: 0, inferenceMs: 0, players: [{ hands: left.map(hand) }, { hands: right.map(hand) }] };
}

/**
 * Calibrates the players in `calibrating`, from the start of the circles to their end, with one
 * frame of hands. Returns the players whose calibration did not count.
 */
function calibrate(
  all: CalibratedPlayer[],
  calibrating: PlayerIndex[],
  frame: TrackingFrame,
  kept: KeptGrids,
  playerCount: PlayerCount,
): PlayerIndex[] {
  beginReach(all, calibrating, playerCount);
  addReach(all, calibrating, frame, playerCount);
  return finishReach(all, calibrating, kept, playerCount);
}

describe('a calibration of one player', () => {
  it('changes only that player’s grid, while the other player moves too', () => {
    const duo = players(2);
    const kept = new KeptGrids();
    duo[1].grid = { x: 0.6, y: 0.2, width: 0.3, height: 0.6 };
    duo[1].calibrated = true;
    const rightBefore = { ...duo[1].grid };
    expect(calibrate(duo, [0], frameWith(BIG_LEFT, BIG_RIGHT), kept, 2)).toEqual([]);
    expect(duo[0].grid).not.toEqual(defaultGrid(0, 2));
    expect(duo[0].calibrated).toBe(true);
    expect(duo[1].grid).toEqual(rightBefore);
    expect(duo[1].calibrated).toBe(true);
    expect(duo[1].reachSamples).toEqual([]);
    expect(kept.get(1, 2)).toBeUndefined();
  });

  it('starts from the standard grid, and grows the grid around the hands', () => {
    const [solo] = players(1);
    solo.grid = { ...CALIBRATED_GRID };
    beginReach([solo], [0], 1);
    expect(solo.grid).toEqual(defaultGrid(0, 1));
    addReach([solo], [0], frameWith(ellipse({ x: 0.5, y: 0.5 }, 0.15, 0.25)), 1);
    expect(solo.grid.width).toBeCloseTo(0.3, 1);
  });
});

describe('a calibration with too little reach', () => {
  it.each([
    ['too few hand positions', BIG_LEFT.slice(0, GRID.fitMinSamples - 1)],
    ['a player who stands still', STILL],
    ['a reach narrower than the smallest grid', ellipse({ x: 0.5, y: 0.5 }, GRID.minWidth / 2 - 0.01, 0.3)],
    ['a reach lower than the smallest grid', ellipse({ x: 0.5, y: 0.5 }, 0.2, GRID.minHeight / 2 - 0.01)],
  ])('changes nothing, with %s', (_, hands) => {
    const solo = players(1);
    const kept = new KeptGrids();
    kept.keep(0, 1, CALIBRATED_GRID);
    solo[0].grid = { ...CALIBRATED_GRID };
    solo[0].calibrated = true;
    expect(calibrate(solo, [0], frameWith(hands), kept, 1)).toEqual([0]);
    expect(solo[0].grid).toEqual(CALIBRATED_GRID);
    expect(solo[0].calibrated).toBe(true);
    expect(kept.get(0, 1)).toEqual(CALIBRATED_GRID);
  });

  it('leaves a player on the standard grid uncalibrated, and keeps no grid', () => {
    const solo = players(1);
    const kept = new KeptGrids();
    calibrate(solo, [0], frameWith(STILL), kept, 1);
    expect(solo[0].grid).toEqual(defaultGrid(0, 1));
    expect(solo[0].calibrated).toBe(false);
    expect(kept.get(0, 1)).toBeUndefined();
  });

  it('changes nothing for that player in a calibration of every player, and counts for the other', () => {
    const duo = players(2);
    const kept = new KeptGrids();
    duo[0].grid = { ...CALIBRATED_GRID };
    duo[0].calibrated = true;
    expect(calibrate(duo, [0, 1], frameWith(STILL, BIG_RIGHT), kept, 2)).toEqual([0]);
    expect(duo[0].grid).toEqual(CALIBRATED_GRID);
    expect(duo[1].grid).not.toEqual(defaultGrid(1, 2));
    expect(duo[1].calibrated).toBe(true);
    expect(kept.get(1, 2)).toEqual(duo[1].grid);
  });

  it('gives back the grid from before a calibration that another one stopped', () => {
    const solo = players(1);
    const kept = new KeptGrids();
    solo[0].grid = { ...CALIBRATED_GRID };
    // The first calibration grows the grid, then the C key starts a second one.
    beginReach(solo, [0], 1);
    addReach(solo, [0], frameWith(BIG_LEFT), 1);
    beginReach(solo, [0], 1);
    addReach(solo, [0], frameWith(STILL), 1);
    expect(finishReach(solo, [0], kept, 1)).toEqual([0]);
    expect(solo[0].grid).toEqual(CALIBRATED_GRID);
    expect(solo[0].gridBeforeReach).toBeNull();
  });
});

describe('the note when a calibration does not count', () => {
  it('speaks to the only player', () => {
    expect(gridNotChangedText([0], 1)).toBe('Grid not changed: draw bigger circles to calibrate');
  });

  it('names the player of two, or both', () => {
    expect(gridNotChangedText([1], 2)).toBe('P2 grid not changed: draw bigger circles to calibrate');
    expect(gridNotChangedText([0, 1], 2)).toBe('P1 and P2 grids not changed: draw bigger circles to calibrate');
  });

  it('is nothing when every calibration counted', () => {
    expect(gridNotChangedText([], 2)).toBeNull();
  });
});

describe('the kept grid', () => {
  it('starts a new round on the grid of the last calibration of each slot', () => {
    const kept = new KeptGrids();
    const first = players(2);
    calibrate(first, [1], frameWith([], BIG_RIGHT), kept, 2);

    const next = players(2);
    startOnKeptGrids(next, kept, 2);
    expect(next[1].grid).toEqual(first[1].grid);
    expect(next[1].calibrated).toBe(true);
    expect(next[0].grid).toEqual(defaultGrid(0, 2));
    expect(next[0].calibrated).toBe(false);
  });

  it('belongs to its player count: one player alone starts on the standard grid', () => {
    const kept = new KeptGrids();
    calibrate(players(2), [0], frameWith(BIG_LEFT), kept, 2);
    const [solo] = players(1);
    startOnKeptGrids([solo], kept, 1);
    expect(solo.grid).toEqual(defaultGrid(0, 1));
    expect(solo.calibrated).toBe(false);
  });

  it('does not change when the player’s grid changes later', () => {
    const kept = new KeptGrids();
    const solo = players(1);
    calibrate(solo, [0], frameWith(BIG_LEFT), kept, 1);
    const keptGrid = kept.get(0, 1);
    solo[0].grid.x += 0.1;
    expect(kept.get(0, 1)).toEqual(keptGrid);
  });
});

describe('the message of the circles', () => {
  it('names the player when one of two players calibrates', () => {
    expect(circlesMessage([1], 2)).toBe('P2: draw the biggest circles you can with both arms!');
  });

  it('names no player when every player calibrates, or when one player plays alone', () => {
    expect(circlesMessage([0, 1], 2)).toBe('Draw the biggest circles you can with both arms!');
    expect(circlesMessage([0], 1)).toBe('Draw the biggest circles you can with both arms!');
  });
});
