import { describe, expect, it } from 'vitest';
import { GAP_MS } from './handMenu';
import type { HandTarget, MenuHand } from './handMenu';
import { newPlayerPointers, stepPlayerPointers } from './playerPointers';
import type { ItemHover } from './playerPointers';
import { newSpentFists, spendFists, withSpentFists } from './spentFists';

/** One tracking frame every this many milliseconds, as a camera at 30 frames per second. */
const FRAME_MS = 33;

/** The intro's "✕ Close" and the menu's Previews switch: the same box in the same corner. */
const CORNER = { x: 1300, y: 40, width: 236, height: 52 };
const CLOSE: HandTarget = { id: 'intro-corner', rect: CORNER, holdSec: 0.8 };
const PREVIEWS: HandTarget = { id: 'previews', rect: CORNER, holdSec: 0.5 };
const ON_CORNER = { x: CORNER.x + 100, y: CORNER.y + 20 };

const fist = (at = ON_CORNER): MenuHand => ({ ...at, fist: true });
const open = (at = ON_CORNER): MenuHand => ({ ...at, fist: false });

/**
 * The panel as flow.ts runs it in `pointAtPanel`: the spent fists apply to each frame, the
 * pointers step, and a choice that opens another screen starts the pointers again and spends
 * the fists that are closed at that moment.
 */
class Panel {
  private pointers = newPlayerPointers(2);
  private spent = newSpentFists(2);
  private targets: HandTarget[];
  private readonly screens: Record<string, HandTarget[]>;
  private nowMs = 0;
  readonly chosen: string[] = [];
  hovers: ItemHover[] = [];

  /** `screens` names the screen that each item opens. */
  constructor(targets: HandTarget[], screens: Record<string, HandTarget[]>) {
    this.targets = targets;
    this.screens = screens;
  }

  /** Runs frames for `durationMs` with the same hands: player 1's, then player 2's. */
  hold(durationMs: number, first: MenuHand[], second: MenuHand[] = []): void {
    for (let passed = 0; passed < durationMs; passed += FRAME_MS) this.frame([first, second]);
  }

  frame(handsByPlayer: MenuHand[][]): void {
    this.nowMs += FRAME_MS;
    const seen = withSpentFists(this.spent, handsByPlayer, this.nowMs);
    this.spent = seen.spent;
    const step = stepPlayerPointers(this.pointers, this.targets, seen.hands, this.nowMs);
    this.pointers = step.states;
    this.hovers = step.hovers;
    for (const id of step.chooseIds) {
      this.chosen.push(id);
      const next = this.screens[id];
      if (!next) continue;
      this.targets = next;
      this.pointers = newPlayerPointers(2);
      this.spent = spendFists(this.spent, handsByPlayer, this.nowMs);
      return;
    }
  }
}

/** The intro, opened from the menu: "✕ Close" leads to the menu, whose Previews switch is in its place. */
const introToMenu = () => new Panel([CLOSE], { 'intro-corner': [PREVIEWS] });

describe('a fist held across a change of screen', () => {
  it('chooses Close, and then does not change the Previews switch in the same place', () => {
    const panel = introToMenu();
    panel.hold(2500, [fist()]);
    expect(panel.chosen).toEqual(['intro-corner']);
  });

  it('still moves the highlight on the new screen, with no hold', () => {
    const panel = introToMenu();
    panel.hold(1500, [fist()]);
    expect(panel.hovers).toEqual([{ id: 'previews', progress: 0 }]);
  });

  it('chooses again once it has opened and closed', () => {
    const panel = introToMenu();
    panel.hold(1000, [fist()]);
    panel.hold(GAP_MS + 2 * FRAME_MS, [open()]);
    panel.hold(700, [fist()]);
    expect(panel.chosen).toEqual(['intro-corner', 'previews']);
  });

  it('stays spent through one frame of flicker with no fist', () => {
    const panel = introToMenu();
    panel.hold(1000, [fist()]);
    panel.frame([[open()], []]);
    panel.frame([[], []]);
    panel.hold(1500, [fist()]);
    expect(panel.chosen).toEqual(['intro-corner']);
  });

  it('leaves the other player free: a hand that was open at the change chooses at once', () => {
    const panel = introToMenu();
    panel.hold(900, [fist()], [open()]);
    expect(panel.chosen).toEqual(['intro-corner']);
    panel.hold(600, [fist()], [fist()]);
    expect(panel.chosen).toEqual(['intro-corner', 'previews']);
  });
});

describe('the spent fists of one frame', () => {
  it('show a spent fist as an open hand, and leave a free one alone', () => {
    const spent = spendFists(newSpentFists(2), [[fist()], [open()]], 1000);
    expect(spent).toEqual([1000, null]);
    const step = withSpentFists(spent, [[fist()], [fist()]], 1000 + FRAME_MS);
    expect(step.hands.map((hands) => hands[0].fist)).toEqual([false, true]);
    expect(step.spent).toEqual([1000 + FRAME_MS, null]);
  });

  it('free a fist after more than the gap with no fist, and not before', () => {
    const spent = [1000, null];
    expect(withSpentFists(spent, [[open()], []], 1000 + GAP_MS).spent).toEqual([1000, null]);
    expect(withSpentFists(spent, [[fist()], []], 1001 + GAP_MS).spent).toEqual([null, null]);
    expect(withSpentFists(spent, [[fist()], []], 1001 + GAP_MS).hands[0][0].fist).toBe(true);
  });
});
