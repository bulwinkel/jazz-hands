import { describe, expect, it } from 'vitest';
import { TIMING } from './config';
import {
  canFinish,
  canGoBack,
  cornerLabel,
  forwardButton,
  forwardControl,
  introAtLoad,
  introControlOfKey,
  introMove,
  menuAsksForCamera,
} from './intro';
import type { IntroCard, IntroOrigin } from './intro';
import { parseSettings } from './settings';

const ALL_CARDS: IntroCard[] = [1, 2, 3, 4];
/** A card that has been open this long is open for every rule. */
const LONG_OPEN_SEC = 10;

/** Whether the page opens on the intro, with these kept settings and this URL. */
const opensOnIntro = (kept: unknown, query: string): boolean => introAtLoad(parseSettings(kept, query));

describe('when the intro shows at page load', () => {
  it('shows on a first visit with the camera', () => {
    expect(opensOnIntro(null, '')).toBe(true);
    expect(opensOnIntro(null, '?input=camera')).toBe(true);
  });

  it('shows for settings kept before the intro existed', () => {
    expect(opensOnIntro({ playerCount: 1, songIndex: 0 }, '')).toBe(true);
  });

  it('does not show once the kept settings say it was seen', () => {
    expect(opensOnIntro({ introSeen: true }, '')).toBe(false);
  });

  it('does not show with the mouse or the bot as the input', () => {
    expect(opensOnIntro(null, '?input=mouse')).toBe(false);
    expect(opensOnIntro(null, '?input=bot')).toBe(false);
  });

  it('does not show when the URL skips the menu', () => {
    expect(opensOnIntro(null, '?autostart=1')).toBe(false);
  });

  it('shows with intro=1 in every case', () => {
    expect(opensOnIntro({ introSeen: true }, '?intro=1')).toBe(true);
    expect(opensOnIntro(null, '?intro=1&input=mouse')).toBe(true);
    expect(opensOnIntro(null, '?intro=1&input=bot')).toBe(true);
    expect(opensOnIntro(null, '?intro=1&autostart=1')).toBe(true);
  });

  it('never shows with intro=0', () => {
    expect(opensOnIntro(null, '?intro=0')).toBe(false);
    expect(opensOnIntro(null, '?intro=0&input=camera')).toBe(false);
  });
});

describe('the controls of the intro on a first visit', () => {
  const firstVisit = (card: IntroCard) => ({ origin: 'first-visit' as IntroOrigin, card });

  it('go to the next card with Next, and stop on the last card', () => {
    expect(introMove(firstVisit(1), 'next', LONG_OPEN_SEC)).toEqual({ to: 'card', card: 2 });
    expect(introMove(firstVisit(2), 'next', LONG_OPEN_SEC)).toEqual({ to: 'card', card: 3 });
    expect(introMove(firstVisit(3), 'next', LONG_OPEN_SEC)).toEqual({ to: 'card', card: 4 });
    expect(introMove(firstVisit(4), 'next', LONG_OPEN_SEC)).toEqual({ to: 'stay' });
  });

  it('go to the card before with Back, but not from card 1', () => {
    expect(introMove(firstVisit(1), 'back', LONG_OPEN_SEC)).toEqual({ to: 'stay' });
    expect(introMove(firstVisit(2), 'back', LONG_OPEN_SEC)).toEqual({ to: 'card', card: 1 });
    expect(introMove(firstVisit(4), 'back', LONG_OPEN_SEC)).toEqual({ to: 'card', card: 3 });
  });

  it('skip to the camera card with the corner, and do nothing there', () => {
    expect(introMove(firstVisit(1), 'corner', LONG_OPEN_SEC)).toEqual({ to: 'card', card: 4 });
    expect(introMove(firstVisit(3), 'corner', LONG_OPEN_SEC)).toEqual({ to: 'card', card: 4 });
    expect(introMove(firstVisit(4), 'corner', LONG_OPEN_SEC)).toEqual({ to: 'stay' });
  });

  it('leave only by the button of the last card', () => {
    for (const card of ALL_CARDS) {
      for (const control of ['next', 'back', 'corner'] as const) {
        expect(introMove(firstVisit(card), control, LONG_OPEN_SEC)).not.toEqual({ to: 'menu' });
      }
    }
    expect(introMove(firstVisit(4), 'finish', LONG_OPEN_SEC)).toEqual({ to: 'menu' });
  });

  it('show the corner as Skip, and not on the last card', () => {
    expect(cornerLabel(firstVisit(1))).toBe('Skip');
    expect(cornerLabel(firstVisit(3))).toBe('Skip');
    expect(cornerLabel(firstVisit(4))).toBeNull();
  });
});

describe('the controls of the intro opened from the menu', () => {
  const fromMenu = (card: IntroCard) => ({ origin: 'menu' as IntroOrigin, card });

  it('step through the cards as on a first visit', () => {
    expect(introMove(fromMenu(1), 'next', LONG_OPEN_SEC)).toEqual({ to: 'card', card: 2 });
    expect(introMove(fromMenu(4), 'next', LONG_OPEN_SEC)).toEqual({ to: 'stay' });
    expect(introMove(fromMenu(1), 'back', LONG_OPEN_SEC)).toEqual({ to: 'stay' });
    expect(introMove(fromMenu(3), 'back', LONG_OPEN_SEC)).toEqual({ to: 'card', card: 2 });
  });

  it('close the intro with the corner, from every card', () => {
    for (const card of ALL_CARDS) {
      expect(introMove(fromMenu(card), 'corner', LONG_OPEN_SEC)).toEqual({ to: 'menu' });
      expect(cornerLabel(fromMenu(card))).toBe('✕ Close');
    }
  });

  it('leave by the button of the last card', () => {
    expect(introMove(fromMenu(4), 'finish', LONG_OPEN_SEC)).toEqual({ to: 'menu' });
  });
});

describe('the button of the last card', () => {
  const lastCard = (origin: IntroOrigin) => ({ origin, card: 4 as IntroCard });

  it('does nothing until card 4 has been open for 0.7 s, on a first visit and from the menu', () => {
    expect(TIMING.introFinishDelaySec).toBe(0.7);
    for (const origin of ['first-visit', 'menu'] as const) {
      expect(introMove(lastCard(origin), 'finish', 0)).toEqual({ to: 'stay' });
      expect(introMove(lastCard(origin), 'finish', 0.69)).toEqual({ to: 'stay' });
      expect(introMove(lastCard(origin), 'finish', 0.7)).toEqual({ to: 'menu' });
      expect(introMove(lastCard(origin), 'finish', 3)).toEqual({ to: 'menu' });
    }
  });

  it('holds back only the way out: the other controls work at once', () => {
    expect(introMove(lastCard('first-visit'), 'back', 0)).toEqual({ to: 'card', card: 3 });
    expect(introMove(lastCard('menu'), 'corner', 0)).toEqual({ to: 'menu' });
    expect(introMove({ origin: 'first-visit', card: 1 }, 'next', 0)).toEqual({ to: 'card', card: 2 });
  });

  it('is free once the delay has passed', () => {
    expect(canFinish(0.5)).toBe(false);
    expect(canFinish(0.7)).toBe(true);
  });
});

describe('the keys of the intro', () => {
  it('step on with →, Enter and Space, and back with ←', () => {
    expect(introControlOfKey('arrowright')).toBe('next');
    expect(introControlOfKey('enter')).toBe('next');
    expect(introControlOfKey(' ')).toBe('next');
    expect(introControlOfKey('arrowleft')).toBe('back');
  });

  it('use Esc as the corner button', () => {
    expect(introControlOfKey('escape')).toBe('corner');
  });

  it('leave every other key alone', () => {
    for (const key of ['m', 'r', 'c', 'f', 'd', 'arrowup', '[']) expect(introControlOfKey(key)).toBeNull();
  });
});

describe('the buttons under the cards', () => {
  it('show Back on every card but the first', () => {
    expect(ALL_CARDS.map(canGoBack)).toEqual([false, true, true, true]);
  });

  it('make the big button Next on cards 1 to 3, and the way out on card 4', () => {
    expect(ALL_CARDS.map(forwardControl)).toEqual(['next', 'next', 'next', 'finish']);
    expect(forwardButton(1, true)).toEqual({ label: 'Next →', note: null });
    expect(forwardButton(3, false)).toEqual({ label: 'Next →', note: null });
  });

  it('say on card 4 that the camera comes next, with a line about the browser, when it does', () => {
    expect(forwardButton(4, true)).toEqual({
      label: 'Turn on the camera →',
      note: 'Your browser asks next. Choose Allow.',
    });
  });

  it('say on card 4 that the menu comes next, with no line, when the camera does not', () => {
    expect(forwardButton(4, false)).toEqual({ label: 'To the menu →', note: null });
  });
});

describe('whether the menu asks for the camera next', () => {
  const handsOn = { handControl: true };
  const handsOff = { handControl: false };

  it('is true with hand control on, the camera as the input and no input open', () => {
    expect(menuAsksForCamera(handsOn, 'camera', false)).toBe(true);
  });

  it('is false while an input is open: the camera runs already', () => {
    expect(menuAsksForCamera(handsOn, 'camera', true)).toBe(false);
  });

  it('is false with hand control off: the menu opens no input then', () => {
    expect(menuAsksForCamera(handsOff, 'camera', false)).toBe(false);
  });

  it('is false with the mouse or the bot as the input', () => {
    expect(menuAsksForCamera(handsOn, 'mouse', false)).toBe(false);
    expect(menuAsksForCamera(handsOn, 'bot', false)).toBe(false);
  });
});
