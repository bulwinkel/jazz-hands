import { describe, expect, it } from 'vitest';
import { newHandMenuState, stepHandMenu } from './handMenu';
import type { HandMenuState, HandTarget, MenuHand } from './handMenu';

const START: HandTarget = { id: 'start', rect: { x: 100, y: 100, width: 200, height: 80 }, holdSec: 0.5 };
const LEVEL: HandTarget = { id: 'level-3', rect: { x: 500, y: 100, width: 200, height: 80 }, holdSec: 0.5 };
const TARGETS = [START, LEVEL];
const FRAME_MS = 33;

const open = (x: number, y: number): MenuHand => ({ x, y, fist: false });
const fist = (x: number, y: number): MenuHand => ({ x, y, fist: true });
const OPEN_ON_START = open(200, 140);
const FIST_ON_START = fist(200, 140);
const OPEN_ON_LEVEL = open(600, 140);
const FIST_ON_LEVEL = fist(600, 140);
const FIST_NOWHERE = fist(400, 600);

/** Feeds frames from `fromMs` up to and including `toMs`, and collects every choice. */
function run(state: HandMenuState, hands: MenuHand[], fromMs: number, toMs: number) {
  const chosen: string[] = [];
  let progress = 0;
  for (let nowMs = fromMs; nowMs <= toMs; nowMs += FRAME_MS) {
    const step = stepHandMenu(state, TARGETS, hands, nowMs);
    state = step.state;
    progress = step.progress;
    if (step.chooseId) chosen.push(step.chooseId);
  }
  return { state, chosen, progress };
}

describe('an open hand', () => {
  it('highlights the item under it', () => {
    expect(run(newHandMenuState(), [OPEN_ON_START], 0, 100).state.hoveredId).toBe('start');
  });

  it('never chooses, however long it stays', () => {
    const result = run(newHandMenuState(), [OPEN_ON_START], 0, 5000);
    expect(result.chosen).toEqual([]);
    expect(result.progress).toBe(0);
  });

  it('moves the highlight from item to item', () => {
    const onStart = run(newHandMenuState(), [OPEN_ON_START], 0, 300);
    expect(run(onStart.state, [OPEN_ON_LEVEL], 333, 600).state.hoveredId).toBe('level-3');
  });

  it('highlights nothing when it is on no item', () => {
    expect(run(newHandMenuState(), [open(400, 600)], 0, 300).state.hoveredId).toBeNull();
  });
});

describe('a fist', () => {
  it('chooses the item after it has been held for the hold time', () => {
    const early = run(newHandMenuState(), [FIST_ON_START], 0, 400);
    expect(early.chosen).toEqual([]);
    expect(early.progress).toBeGreaterThan(0.7);
    expect(run(early.state, [FIST_ON_START], 433, 600).chosen).toEqual(['start']);
  });

  it('chooses once, however long it is held', () => {
    expect(run(newHandMenuState(), [FIST_ON_START], 0, 4000).chosen).toEqual(['start']);
  });

  it('chooses again after the hand has opened and closed again', () => {
    const first = run(newHandMenuState(), [FIST_ON_START], 0, 700);
    const opened = run(first.state, [OPEN_ON_START], 733, 1300);
    const second = run(opened.state, [FIST_ON_START], 1333, 2100);
    expect(first.chosen.concat(second.chosen)).toEqual(['start', 'start']);
  });

  it('does nothing away from any item', () => {
    expect(run(newHandMenuState(), [FIST_NOWHERE], 0, 3000).chosen).toEqual([]);
  });

  it('starts its hold again when it moves to another item', () => {
    const onStart = run(newHandMenuState(), [FIST_ON_START], 0, 400);
    const onLevel = run(onStart.state, [FIST_ON_LEVEL], 433, 800);
    expect(onLevel.chosen).toEqual([]);
    expect(run(onLevel.state, [FIST_ON_LEVEL], 833, 1100).chosen).toEqual(['level-3']);
  });

  it('counts when the hand arrives open and then closes', () => {
    const hovering = run(newHandMenuState(), [OPEN_ON_START], 0, 2000);
    const closed = run(hovering.state, [FIST_ON_START], 2033, 2400);
    expect(closed.chosen).toEqual([]);
    expect(run(closed.state, [FIST_ON_START], 2433, 2700).chosen).toEqual(['start']);
  });

  it('counts just outside the edge of an item, so jitter does not break the hold', () => {
    expect(run(newHandMenuState(), [fist(START.rect.x - 8, 140)], 0, 700).chosen).toEqual(['start']);
  });
});

describe('a fist on an item that steps through a list', () => {
  const NEXT: HandTarget = { id: 'next', rect: START.rect, holdSec: 0.5, repeats: true };

  /** Feeds frames with a fist on the step item, and collects the time of every choice. */
  function hold(fromMs: number, toMs: number, state = newHandMenuState()) {
    const chosenAtMs: number[] = [];
    let progress = 0;
    for (let nowMs = fromMs; nowMs <= toMs; nowMs += FRAME_MS) {
      const step = stepHandMenu(state, [NEXT], [FIST_ON_START], nowMs);
      state = step.state;
      progress = step.progress;
      if (step.chooseId) chosenAtMs.push(nowMs);
    }
    return { state, chosenAtMs, progress };
  }

  it('chooses again after each hold time while the fist stays', () => {
    const { chosenAtMs } = hold(0, 1700);
    expect(chosenAtMs).toHaveLength(3);
    expect(chosenAtMs[1] - chosenAtMs[0]).toBeGreaterThanOrEqual(500);
    expect(chosenAtMs[2] - chosenAtMs[1]).toBeGreaterThanOrEqual(500);
  });

  it('starts its bar again from nothing after each choice', () => {
    const first = hold(0, 528); // The frame at 528 ms is the first past the hold time.
    expect(first.chosenAtMs).toEqual([528]);
    expect(first.progress).toBe(1);
    expect(hold(561, 561, first.state).progress).toBeLessThan(0.1);
  });

  it('stops when the fist opens', () => {
    const held = hold(0, 700);
    expect(run(held.state, [OPEN_ON_START], 733, 3000).chosen).toEqual([]);
  });
});

describe('tracking flicker', () => {
  it('keeps a hold when the fist is read as open for a few frames', () => {
    const held = run(newHandMenuState(), [FIST_ON_START], 0, 300);
    const misread = run(held.state, [OPEN_ON_START], 333, 480);
    expect(misread.progress).toBeGreaterThan(0);
    expect(run(misread.state, [FIST_ON_START], 513, 700).chosen).toEqual(['start']);
  });

  it('keeps a hold when the hand is lost for a few frames', () => {
    const held = run(newHandMenuState(), [FIST_ON_START], 0, 300);
    const lost = run(held.state, [], 333, 480);
    expect(lost.state.hoveredId).toBe('start');
    expect(run(lost.state, [FIST_ON_START], 513, 700).chosen).toEqual(['start']);
  });

  it('ends the hold when the hand stays open', () => {
    const held = run(newHandMenuState(), [FIST_ON_START], 0, 300);
    const opened = run(held.state, [OPEN_ON_START], 333, 900);
    expect(opened.progress).toBe(0);
    expect(opened.chosen).toEqual([]);
  });

  it('never chooses on a frame without a fist, even when the hold time has run out', () => {
    const held = run(newHandMenuState(), [FIST_ON_START], 0, 430);
    expect(run(held.state, [OPEN_ON_START], 463, 660).chosen).toEqual([]);
    expect(run(held.state, [], 463, 660).chosen).toEqual([]);
  });
});

describe('two hands', () => {
  it('lets either hand choose', () => {
    expect(run(newHandMenuState(), [open(400, 600), FIST_ON_LEVEL], 0, 700).chosen).toEqual(['level-3']);
  });

  it('stays with the item it is holding when the other hand rests on another item', () => {
    const held = run(newHandMenuState(), [FIST_ON_LEVEL], 0, 300);
    expect(run(held.state, [OPEN_ON_START, FIST_ON_LEVEL], 333, 700).chosen).toEqual(['level-3']);
  });
});

describe('a fist that moves along a row of touching items, as the rating stars', () => {
  /** Five stars of 69 by 60 pixels side by side: their hit areas in a 1280×720 window. */
  const STARS: HandTarget[] = [1, 2, 3, 4, 5].map((star) => ({
    id: `rate-0-${star}`,
    rect: { x: 225 + (star - 1) * 69, y: 387, width: 69, height: 60 },
    holdSec: 0.5,
  }));
  const ROW_MIDDLE_Y = 417;

  /** Moves a fist along the middle of the row from `fromX` to `toX` at `pxPerSec`, and collects every choice. */
  function sweep(fromX: number, toX: number, pxPerSec: number, state = newHandMenuState()) {
    const chosen: string[] = [];
    const durationMs = (Math.abs(toX - fromX) / pxPerSec) * 1000;
    let nowMs = 0;
    for (; nowMs <= durationMs; nowMs += FRAME_MS) {
      const x = fromX + (toX - fromX) * (nowMs / durationMs);
      const step = stepHandMenu(state, STARS, [fist(x, ROW_MIDDLE_Y)], nowMs);
      state = step.state;
      if (step.chooseId) chosen.push(step.chooseId);
    }
    return { state, chosen, endMs: nowMs };
  }

  it('chooses no star that it only passes, in either direction', () => {
    expect(sweep(200, 620, 400).chosen).toEqual([]);
    expect(sweep(620, 200, 200).chosen).toEqual([]);
  });

  it('chooses the star where it stops and holds', () => {
    const passed = sweep(200, 466, 400);
    expect(passed.chosen).toEqual([]);
    const chosen: string[] = [];
    let state = passed.state;
    for (let nowMs = passed.endMs; nowMs <= passed.endMs + 600; nowMs += FRAME_MS) {
      const step = stepHandMenu(state, STARS, [fist(466, ROW_MIDDLE_Y)], nowMs);
      state = step.state;
      if (step.chooseId) chosen.push(step.chooseId);
    }
    expect(chosen).toEqual(['rate-0-4']);
  });

  it('chooses a star that it stays on for the hold time, however slowly it moves', () => {
    // At 100 pixels a second, the fist stays on each 69-pixel star for longer than 0.5 s.
    expect(sweep(200, 620, 100).chosen.length).toBeGreaterThan(0);
  });
});

describe('stepHandMenu', () => {
  it('never changes the state it is given', () => {
    const state = newHandMenuState();
    const copy = { ...state };
    stepHandMenu(state, TARGETS, [FIST_ON_START], 50);
    expect(state).toEqual(copy);
  });
});
