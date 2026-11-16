import { describe, expect, it } from 'vitest';
import type { TrackedHand, TrackingFrame } from '../tracking/types';
import { addReach, beginReach, circlesMessage, finishReach, KeptGrids, startOnKeptGrids } from './calibration';
import type { CalibratedPlayer } from './calibration';
import { GRID } from './config';
import { defaultGrid } from './geometry';
import { createPlayers } from './player';
import { parseSettings } from './settings';
import type { PlayerCount, PlayerIndex, Point } from './types';

function players(count: PlayerCount): CalibratedPlayer[] {
  return createPlayers(parseSettings(null, `?players=${count}`).settings);
}

/** Hand positions on a circle around `centre`, enough to fit a grid to. */
function circle(centre: Point, radius: number): Point[] {
  return Array.from({ length: GRID.fitMinSamples * 2 }, (_, i) => {
    const angle = (i / GRID.fitMinSamples) * Math.PI;
    return { x: centre.x + Math.cos(angle) * radius, y: centre.y + Math.sin(angle) * radius };
  });
}

/** A tracking frame with these hands for the left player, or the only player, and these for the right player. */
function frameWith(left: readonly Point[], right: readonly Point[] = []): TrackingFrame {
  const hand = (point: Point): TrackedHand => ({ ...point, size: 0.05, gesture: 'open', gestureScore: 1 });
  return { timeMs: 0, inferenceMs: 0, players: [{ hands: left.map(hand) }, { hands: right.map(hand) }] };
}

/** Calibrates the players in `calibrating`, from the start of the circles to their end, with one frame of hands. */
function calibrate(
  all: CalibratedPlayer[],
  calibrating: PlayerIndex[],
  frame: TrackingFrame,
  kept: KeptGrids,
  playerCount: PlayerCount,
): void {
  beginReach(all, calibrating, playerCount);
  addReach(all, calibrating, frame, playerCount);
  finishReach(all, calibrating, kept, playerCount);
}

describe('a calibration of one player', () => {
  it('changes only that player’s grid, while the other player moves too', () => {
    const duo = players(2);
    const kept = new KeptGrids();
    duo[1].grid = { x: 0.6, y: 0.2, width: 0.3, height: 0.6 };
    duo[1].calibrated = true;
    const rightBefore = { ...duo[1].grid };
    const frame = frameWith(circle({ x: 0.25, y: 0.55 }, 0.1), circle({ x: 0.75, y: 0.5 }, 0.12));
    calibrate(duo, [0], frame, kept, 2);
    expect(duo[0].grid).not.toEqual(defaultGrid(0, 2));
    expect(duo[0].calibrated).toBe(true);
    expect(duo[1].grid).toEqual(rightBefore);
    expect(duo[1].calibrated).toBe(true);
    expect(duo[1].reachSamples).toEqual([]);
    expect(kept.get(1, 2)).toBeUndefined();
  });

  it('starts from the standard grid, and grows the grid around the hands', () => {
    const [solo] = players(1);
    solo.grid = { x: 0.3, y: 0.3, width: 0.2, height: 0.4 };
    solo.calibrated = true;
    beginReach([solo], [0], 1);
    expect(solo.grid).toEqual(defaultGrid(0, 1));
    expect(solo.calibrated).toBe(false);
    addReach([solo], [0], frameWith(circle({ x: 0.5, y: 0.55 }, 0.15)), 1);
    expect(solo.grid.width).toBeCloseTo(0.3, 1);
  });

  it('keeps the standard grid, and counts as no calibration, when it saw too few hands', () => {
    const [solo] = players(1);
    const kept = new KeptGrids();
    const fewHands = circle({ x: 0.5, y: 0.55 }, 0.15).slice(0, GRID.fitMinSamples - 1);
    calibrate([solo], [0], frameWith(fewHands), kept, 1);
    expect(solo.grid).toEqual(defaultGrid(0, 1));
    expect(solo.calibrated).toBe(false);
    expect(kept.get(0, 1)).toBeUndefined();
  });
});

describe('the kept grid', () => {
  it('starts a new round on the grid of the last calibration of each slot', () => {
    const kept = new KeptGrids();
    const first = players(2);
    calibrate(first, [1], frameWith([], circle({ x: 0.75, y: 0.5 }, 0.12)), kept, 2);

    const next = players(2);
    startOnKeptGrids(next, kept, 2);
    expect(next[1].grid).toEqual(first[1].grid);
    expect(next[1].calibrated).toBe(true);
    expect(next[0].grid).toEqual(defaultGrid(0, 2));
    expect(next[0].calibrated).toBe(false);
  });

  it('belongs to its player count: one player alone starts on the standard grid', () => {
    const kept = new KeptGrids();
    calibrate(players(2), [0], frameWith(circle({ x: 0.25, y: 0.5 }, 0.12)), kept, 2);
    const [solo] = players(1);
    startOnKeptGrids([solo], kept, 1);
    expect(solo.grid).toEqual(defaultGrid(0, 1));
    expect(solo.calibrated).toBe(false);
  });

  it('is forgotten by a later calibration that saw too few hands', () => {
    const kept = new KeptGrids();
    const solo = players(1);
    calibrate(solo, [0], frameWith(circle({ x: 0.5, y: 0.55 }, 0.15)), kept, 1);
    expect(kept.get(0, 1)).toBeDefined();
    calibrate(solo, [0], frameWith([]), kept, 1);
    expect(kept.get(0, 1)).toBeUndefined();
  });

  it('does not change when the player’s grid changes later', () => {
    const kept = new KeptGrids();
    const solo = players(1);
    calibrate(solo, [0], frameWith(circle({ x: 0.5, y: 0.55 }, 0.15)), kept, 1);
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
