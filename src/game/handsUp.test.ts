import { describe, expect, it } from 'vitest';
import type { TrackedHand, TrackingFrame } from '../tracking/types';
import { HANDS_UP_CELL, TIMING } from './config';
import { cellRect } from './geometry';
import { clearHolds, stepHandsUp } from './handsUp';
import type { HoldingPlayer } from './handsUp';
import { createPlayers } from './player';
import { parseSettings } from './settings';

function players(count: 1 | 2): HoldingPlayer[] {
  return createPlayers(parseSettings(null, `?players=${count}`).settings);
}

/** A hand in the middle of a player's hands-up cell. */
function handUp(player: HoldingPlayer): TrackedHand {
  const cell = cellRect(player.grid, HANDS_UP_CELL);
  return { x: cell.x + cell.width / 2, y: cell.y + cell.height / 2, size: 0.05, gesture: 'open', gestureScore: 1 };
}

/** A tracking frame at `timeMs`, with a raised hand for each player in `raised`. */
function frame(timeMs: number, all: readonly HoldingPlayer[], raised: readonly HoldingPlayer[]): TrackingFrame {
  const hands = (index: number): TrackedHand[] => raised.filter((p) => p.index === index).map(handUp);
  return { timeMs, inferenceMs: 0, players: [{ hands: hands(0) }, { hands: hands(all.length > 1 ? 1 : -1) }] };
}

describe('hands-up hold', () => {
  it('fills while a hand stays in the hands-up cell, and is done after the hold time', () => {
    const solo = players(1);
    expect(stepHandsUp(solo, frame(1000, solo, solo), undefined, 1)).toBe(false);
    expect(stepHandsUp(solo, frame(1500, solo, solo), frame(1000, solo, solo), 1)).toBe(false);
    expect(solo[0].hold).toBeCloseTo(0.5);
    expect(stepHandsUp(solo, frame(2000, solo, solo), frame(1500, solo, solo), 1)).toBe(true);
    expect(solo[0].hold).toBe(1);
  });

  it('starts again from nothing when the hand leaves the cell', () => {
    const solo = players(1);
    stepHandsUp(solo, frame(1000, solo, solo), undefined, 1);
    stepHandsUp(solo, frame(1500, solo, []), frame(1000, solo, solo), 1);
    expect(solo[0].hold).toBe(0);
    stepHandsUp(solo, frame(1600, solo, solo), frame(1500, solo, []), 1);
    expect(solo[0].holdStartMs).toBe(1600);
  });

  it('starts again when the tracking frames had a gap longer than a stale frame', () => {
    const solo = players(1);
    stepHandsUp(solo, frame(1000, solo, solo), undefined, 1);
    const late = 1000 + TIMING.staleFrameMs + 1;
    stepHandsUp(solo, frame(late, solo, solo), frame(1000, solo, solo), 1);
    expect(solo[0].holdStartMs).toBe(late);
    expect(solo[0].hold).toBe(0);
  });

  it('waits until every player holds', () => {
    const duo = players(2);
    const onlyLeft = [duo[0]];
    expect(stepHandsUp(duo, frame(1000, duo, onlyLeft), undefined, 0.2)).toBe(false);
    expect(stepHandsUp(duo, frame(1100, duo, onlyLeft), frame(1000, duo, onlyLeft), 0.2)).toBe(false);
    expect(stepHandsUp(duo, frame(1200, duo, onlyLeft), frame(1100, duo, onlyLeft), 0.2)).toBe(false);
    expect(duo[0].hold).toBe(1);
    expect(duo[1].hold).toBe(0);
    expect(stepHandsUp(duo, frame(1300, duo, duo), frame(1200, duo, onlyLeft), 0.2)).toBe(false);
    expect(stepHandsUp(duo, frame(1400, duo, duo), frame(1300, duo, duo), 0.2)).toBe(false);
    expect(stepHandsUp(duo, frame(1500, duo, duo), frame(1400, duo, duo), 0.2)).toBe(true);
  });

  it('forgets every hold when cleared', () => {
    const duo = players(2);
    stepHandsUp(duo, frame(1000, duo, duo), undefined, 1);
    stepHandsUp(duo, frame(1500, duo, duo), frame(1000, duo, duo), 1);
    clearHolds(duo);
    expect(duo.map((p) => [p.holdStartMs, p.hold])).toEqual([
      [null, 0],
      [null, 0],
    ]);
  });
});
