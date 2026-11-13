import { describe, expect, it } from 'vitest';
import type { HandMenuState, HandTarget, MenuHand } from './handMenu';
import { chooseInTurn, newPlayerPointers, stepPlayerPointers } from './playerPointers';
import type { ItemHover } from './playerPointers';

const STAR_OF_P1: HandTarget = { id: 'rate-0-3', rect: { x: 100, y: 400, width: 70, height: 60 }, holdSec: 0.5 };
const STAR_OF_P2: HandTarget = { id: 'rate-1-2', rect: { x: 700, y: 400, width: 70, height: 60 }, holdSec: 0.5 };
const REPLAY: HandTarget = { id: 'replay', rect: { x: 400, y: 600, width: 200, height: 60 }, holdSec: 0.8 };
const NEXT_SONG: HandTarget = { id: 'song-next', rect: { x: 900, y: 100, width: 80, height: 80 }, holdSec: 0.5, repeats: true };
const TARGETS = [STAR_OF_P1, STAR_OF_P2, REPLAY, NEXT_SONG];
const FRAME_MS = 33;

/** A hand in the middle of `target`: a fist, or an open hand. */
const fistOn = (target: HandTarget): MenuHand => ({ ...middleOf(target), fist: true });
const openOn = (target: HandTarget): MenuHand => ({ ...middleOf(target), fist: false });
function middleOf(target: HandTarget) {
  return { x: target.rect.x + target.rect.width / 2, y: target.rect.y + target.rect.height / 2 };
}

/**
 * Feeds frames from `fromMs` up to and including `toMs`, with the same hands of each player on
 * every frame. Collects the choices of each frame, and the hovers of the last frame.
 */
function run(states: HandMenuState[], handsByPlayer: MenuHand[][], fromMs: number, toMs: number) {
  const choicesByFrame: string[][] = [];
  let hovers: ItemHover[] = [];
  for (let nowMs = fromMs; nowMs <= toMs; nowMs += FRAME_MS) {
    const step = stepPlayerPointers(states, TARGETS, handsByPlayer, nowMs);
    states = step.states;
    hovers = step.hovers;
    if (step.chooseIds.length > 0) choicesByFrame.push(step.chooseIds);
  }
  return { states, hovers, choicesByFrame, chosen: choicesByFrame.flat() };
}

describe('two players on two items at once', () => {
  it('shows both highlights, each with its own hold', () => {
    const held = run(newPlayerPointers(2), [[fistOn(STAR_OF_P1)], [openOn(STAR_OF_P2)]], 0, 300);
    expect(held.hovers).toEqual([
      { id: 'rate-0-3', progress: expect.closeTo(0.6, 1) },
      { id: 'rate-1-2', progress: 0 },
    ]);
  });

  it('lets both choose on the same frame, in player order', () => {
    const { choicesByFrame } = run(newPlayerPointers(2), [[fistOn(STAR_OF_P1)], [fistOn(STAR_OF_P2)]], 0, 1000);
    expect(choicesByFrame).toEqual([['rate-0-3', 'rate-1-2']]);
  });

  it('lets each player choose on either card', () => {
    const { chosen } = run(newPlayerPointers(2), [[fistOn(STAR_OF_P2)], [fistOn(STAR_OF_P1)]], 0, 1000);
    expect(chosen).toEqual(['rate-1-2', 'rate-0-3']);
  });
});

describe('two players on one item', () => {
  it('shows one highlight, with the mark of the hold that is further along', () => {
    const first = run(newPlayerPointers(2), [[fistOn(REPLAY)], []], 0, 198);
    const both = run(first.states, [[fistOn(REPLAY)], [fistOn(REPLAY)]], 231, 396);
    expect(both.hovers).toHaveLength(1);
    expect(both.hovers[0].id).toBe('replay');
    expect(both.hovers[0].progress).toBeCloseTo(396 / 800, 2);
  });

  it('chooses the item once when both fists start on the same frame', () => {
    const { choicesByFrame } = run(newPlayerPointers(2), [[fistOn(REPLAY)], [fistOn(REPLAY)]], 0, 3000);
    expect(choicesByFrame).toEqual([['replay']]);
  });

  it('chooses the item once when the second fist finishes its hold later', () => {
    const first = run(newPlayerPointers(2), [[fistOn(REPLAY)], []], 0, 297);
    const both = run(first.states, [[fistOn(REPLAY)], [fistOn(REPLAY)]], 330, 3000);
    expect(first.chosen.concat(both.chosen)).toEqual(['replay']);
  });

  it('lets a player whose hold was spent choose again after opening and closing the fist', () => {
    const both = run(newPlayerPointers(2), [[fistOn(REPLAY)], [fistOn(REPLAY)]], 0, 1000);
    const opened = run(both.states, [[], [openOn(REPLAY)]], 1033, 1600);
    const again = run(opened.states, [[], [fistOn(REPLAY)]], 1633, 2600);
    expect(both.chosen.concat(opened.chosen, again.chosen)).toEqual(['replay', 'replay']);
  });
});

describe('an item that steps through a list', () => {
  it('keeps stepping under one player\'s fist while the other player is on another item', () => {
    const { chosen } = run(newPlayerPointers(2), [[fistOn(NEXT_SONG)], [openOn(REPLAY)]], 0, 1700);
    expect(chosen).toEqual(['song-next', 'song-next', 'song-next']);
  });

  it('steps once for each hold time under two fists, not twice', () => {
    const first = run(newPlayerPointers(2), [[fistOn(NEXT_SONG)], []], 0, 198);
    const both = run(first.states, [[fistOn(NEXT_SONG)], [fistOn(NEXT_SONG)]], 231, 1700);
    expect(both.chosen).toEqual(['song-next', 'song-next', 'song-next']);
  });
});

describe('a player with no hands', () => {
  it('has no hover from the start', () => {
    const { states, hovers } = run(newPlayerPointers(2), [[openOn(REPLAY)], []], 0, 300);
    expect(states[1].hoveredId).toBeNull();
    expect(hovers.map((hover) => hover.id)).toEqual(['replay']);
  });

  it('loses the hover once the hands have been gone for longer than a tracking gap', () => {
    const hovering = run(newPlayerPointers(2), [[], [openOn(STAR_OF_P2)]], 0, 300);
    const gone = run(hovering.states, [[], []], 333, 700);
    expect(gone.states[1].hoveredId).toBeNull();
    expect(gone.hovers).toEqual([]);
  });

  it('starts with no hover when its slot is new', () => {
    const step = stepPlayerPointers([], TARGETS, [[], [openOn(REPLAY)]], 0);
    expect(step.states).toHaveLength(2);
    expect(step.hovers).toEqual([{ id: 'replay', progress: 0 }]);
  });
});

describe('choosing the items of one frame', () => {
  it('chooses each item in turn while the screen stays the same', () => {
    const chosen: string[] = [];
    chooseInTurn(['rate-0-3', 'rate-1-2'], (id) => chosen.push(id), () => 'results');
    expect(chosen).toEqual(['rate-0-3', 'rate-1-2']);
  });

  it('stops after a choice that changes the screen', () => {
    const chosen: string[] = [];
    let screen = 'results';
    const choose = (id: string) => {
      chosen.push(id);
      if (id === 'replay') screen = 'countdown';
    };
    chooseInTurn(['replay', 'rate-1-2'], choose, () => screen);
    expect(chosen).toEqual(['replay']);
  });
});

describe('stepPlayerPointers', () => {
  it('never changes the states it is given', () => {
    const states = newPlayerPointers(2);
    const copy = structuredClone(states);
    stepPlayerPointers(states, TARGETS, [[fistOn(REPLAY)], [fistOn(REPLAY)]], 900);
    expect(states).toEqual(copy);
  });
});
