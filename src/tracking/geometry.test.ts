import { describe, expect, it } from 'vitest';
import { assignHands, cropToFrame, gestureName, handSize, mirror, palmCentre, playerForX, posePlayers } from './geometry';
import type { VisiblePoint } from './geometry';
import type { TrackedHand } from './types';

describe('mirrored full-frame coordinates', () => {
  it('maps the raw right half to player 0, and the raw left half to player 1', () => {
    expect(mirror({ x: 0.8, y: 0.3 })).toEqual({ x: 0.19999999999999996, y: 0.3 });
    const right = cropToFrame({ x: 0.6, y: 0.2 }, { x: 0.5, y: 0, width: 0.5, height: 1 });
    const left = cropToFrame({ x: 0.6, y: 0.2 }, { x: 0, y: 0, width: 0.5, height: 1 });
    expect(right.x).toBeCloseTo(0.2);
    expect(left.x).toBeCloseTo(0.7);
    expect(playerForX(right.x)).toBe(0);
    expect(playerForX(left.x)).toBe(1);
    expect(playerForX(0.5)).toBe(1);
    expect(cropToFrame({ x: 0, y: 1 })).toEqual({ x: 1, y: 1 });
  });

  it('maps odd-width and offset crops before computing height-relative size', () => {
    const crop = { x: 960 / 1921, y: 0.1, width: 961 / 1921, height: 0.8 };
    expect(cropToFrame({ x: 1, y: 0.5 }, crop)).toEqual({ x: 0, y: 0.5 });
    const points = [{ x: 0.2, y: 0.3 }, { x: 0.4, y: 0.7 }];
    expect(handSize(points, 2)).toBeCloseTo(Math.hypot(0.4, 0.4));
    expect(handSize([], 2)).toBe(0);
  });

  it('uses wrist and MCP landmarks for the palm, without fingertip bias', () => {
    const points = Array.from({ length: 21 }, () => ({ x: 1, y: 1 }));
    for (const index of [0, 5, 9, 13, 17]) points[index] = { x: 0.2, y: 0.3 };
    expect(palmCentre(points).x).toBeCloseTo(0.2);
    expect(palmCentre(points).y).toBeCloseTo(0.3);
  });

  it('keeps the largest two hands independently per player without mutating input', () => {
    const hand = (x: number, size: number): TrackedHand => ({ x, y: 0.5, size, gesture: 'none', gestureScore: 0 });
    const hands = [hand(0.2, 0.1), hand(0.1, 0.3), hand(0.3, 0.2), hand(0.8, 0.05)];
    expect(assignHands(hands).map((player) => player.hands.map((item) => item.size)))
      .toEqual([[0.3, 0.2], [0.05]]);
    expect(hands[0].size).toBe(0.1);
  });
});

it.each([
  ['Closed_Fist', 'fist'], ['Open_Palm', 'open'], ['Pointing_Up', 'point'], ['Victory', 'peace'],
  ['Thumb_Up', 'thumbsUp'], ['Thumb_Down', 'thumbsDown'], ['ILoveYou', 'rock'],
  ['None', 'none'], ['', 'none'], [undefined, 'none'], ['Other', 'none'], ['toString', 'none'],
])('maps gesture %s to %s', (category, expected) => expect(gestureName(category)).toBe(expected));

describe('pose palms and ownership', () => {
  const pose = (x: number, visibility = 1): VisiblePoint[] => Array.from({ length: 33 }, () => ({ x, y: 0.4, visibility }));

  it('keeps crossing hands with their torso and outputs unknown gestures', () => {
    const left = pose(0.8);
    left[15] = { x: 0.3, y: 0.7, visibility: 1 };
    left[17] = { x: 0.1, y: 0.5, visibility: 1 };
    left[19] = { x: 0.2, y: 0.6, visibility: 1 };
    const players = posePlayers([left, pose(0.2)], 16 / 9, 0.3);
    expect(players.map((player) => player.hands.length)).toEqual([2, 2]);
    expect(players[0].hands[0].x).toBeCloseTo(0.8);
    expect(players[0].hands[0].y).toBeCloseTo(0.6);
    expect(players[0].hands[0].gesture).toBe('unknown');
    expect(players[0].hands[0].gestureScore).toBe(0);
  });

  it('rejects low-visibility hands and torsos; chooses one pose per half', () => {
    const visible = pose(0.8);
    visible[15].visibility = 0.2;
    const missingVisibility = pose(0.8).map(({ x, y }) => ({ x, y }));
    const players = posePlayers([pose(0.8, 0.6), visible, pose(0.2, 0.1), missingVisibility], 1, 0.3);
    expect(players.map((player) => player.hands.length)).toEqual([1, 0]);
  });
});
