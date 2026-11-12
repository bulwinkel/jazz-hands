import { describe, expect, it } from 'vitest';
import { newHandMenuState, stepHandMenu } from './handMenu';
import type { HandMenuState, HandTarget } from './handMenu';
import type { Point } from './types';

const START: HandTarget = { id: 'start', rect: { x: 100, y: 100, width: 200, height: 80 }, dwellSec: 1 };
const LEVEL: HandTarget = { id: 'level-3', rect: { x: 500, y: 100, width: 200, height: 80 }, dwellSec: 1 };
const TARGETS = [START, LEVEL];

const ON_START: Point = { x: 200, y: 140 };
const ON_LEVEL: Point = { x: 600, y: 140 };
const NOWHERE: Point = { x: 400, y: 600 };
const FRAME_MS = 33;

/** Feeds frames from `fromMs` up to and including `toMs`, and collects every press. */
function run(state: HandMenuState, hands: Point[], fromMs: number, toMs: number) {
  const presses: string[] = [];
  let progress = 0;
  for (let nowMs = fromMs; nowMs <= toMs; nowMs += FRAME_MS) {
    const step = stepHandMenu(state, TARGETS, hands, nowMs);
    state = step.state;
    progress = step.progress;
    if (step.pressId) presses.push(step.pressId);
  }
  return { state, presses, progress };
}

describe('pointing at a menu item', () => {
  it('presses it after the hand has stayed for the dwell time', () => {
    const early = run(newHandMenuState(), [ON_START], 0, 900);
    expect(early.presses).toEqual([]);
    expect(early.progress).toBeGreaterThan(0.8);

    const done = run(early.state, [ON_START], 900 + FRAME_MS, 1100);
    expect(done.presses).toEqual(['start']);
  });

  it('presses it once, however long the hand stays', () => {
    expect(run(newHandMenuState(), [ON_START], 0, 5000).presses).toEqual(['start']);
  });

  it('can press it again after the hand has left and come back', () => {
    const first = run(newHandMenuState(), [ON_START], 0, 1200);
    const away = run(first.state, [NOWHERE], 1233, 1800);
    const second = run(away.state, [ON_START], 1833, 3000);
    expect(first.presses.concat(second.presses)).toEqual(['start', 'start']);
  });

  it('does nothing for a hand that only passes over it', () => {
    expect(run(newHandMenuState(), [ON_START], 0, 400).presses).toEqual([]);
    const passed = run(run(newHandMenuState(), [ON_START], 0, 400).state, [NOWHERE], 433, 2000);
    expect(passed.presses).toEqual([]);
    expect(passed.state.hoveredId).toBeNull();
  });

  it('starts the hold again when the hand moves to another item', () => {
    const onStart = run(newHandMenuState(), [ON_START], 0, 800);
    const onLevel = run(onStart.state, [ON_LEVEL], 833, 1500);
    expect(onLevel.presses).toEqual([]);
    expect(onLevel.state.hoveredId).toBe('level-3');
    expect(run(onLevel.state, [ON_LEVEL], 1533, 1900).presses).toEqual(['level-3']);
  });

  it('counts a hand just outside the edge, so jitter does not break the hold', () => {
    const justOutside: Point = { x: START.rect.x - 8, y: 140 };
    expect(run(newHandMenuState(), [justOutside], 0, 1100).presses).toEqual(['start']);
  });
});

describe('tracking gaps', () => {
  it('keeps a hold through a few lost frames', () => {
    const held = run(newHandMenuState(), [ON_START], 0, 600);
    const lost = run(held.state, [], 633, 780);
    expect(lost.state.hoveredId).toBe('start');
    expect(run(lost.state, [ON_START], 813, 1100).presses).toEqual(['start']);
  });

  it('drops a hold when the hand stays lost', () => {
    const held = run(newHandMenuState(), [ON_START], 0, 600);
    const lost = run(held.state, [], 633, 1200);
    expect(lost.state.hoveredId).toBeNull();
    expect(lost.presses).toEqual([]);
  });

  it('does not press while the hand is lost, even when the dwell time runs out', () => {
    const held = run(newHandMenuState(), [ON_START], 0, 900);
    expect(run(held.state, [], 933, 1130).presses).toEqual([]);
  });
});

describe('two hands', () => {
  it('lets either hand hold an item', () => {
    expect(run(newHandMenuState(), [NOWHERE, ON_LEVEL], 0, 1100).presses).toEqual(['level-3']);
  });

  it('stays with the item it is holding when the other hand rests on another item', () => {
    const held = run(newHandMenuState(), [ON_LEVEL], 0, 500);
    expect(run(held.state, [ON_START, ON_LEVEL], 533, 1100).presses).toEqual(['level-3']);
  });
});

describe('stepHandMenu', () => {
  it('never changes the state it is given', () => {
    const state = newHandMenuState();
    const copy = { ...state };
    stepHandMenu(state, TARGETS, [ON_START], 50);
    expect(state).toEqual(copy);
  });
});
