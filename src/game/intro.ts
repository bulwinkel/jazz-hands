import type { InputSource, Options, Settings } from './settings';

/**
 * The "How to play" intro: four cards that show a new player what to do, and why the game
 * needs the camera, before the browser asks for it. This module is the rule only: when the
 * intro shows, which card a control leads to, and what its buttons say. introView.ts builds
 * the page, and flow.ts runs it.
 */

/** The intro has this many cards. The last one is about the camera. */
export const INTRO_CARD_COUNT = 4;

/** A card of the intro, from 1. */
export type IntroCard = 1 | 2 | 3 | 4;

/**
 * How the intro opened.
 * - `first-visit`: at page load. It ends only by the button of its last card, so every new
 *   player reads the camera card before the browser asks for the camera.
 * - `menu`: from the menu's button. The player has seen the game, so it can close at any card.
 */
export type IntroOrigin = 'first-visit' | 'menu';

/** The open intro: how it opened, and which card shows. */
export interface IntroState {
  origin: IntroOrigin;
  card: IntroCard;
}

/**
 * What a player can do in the intro:
 * - `next`: the "Next →" button, the → key, Enter and Space;
 * - `back`: the "← Back" button and the ← key;
 * - `corner`: the button in the corner, "Skip" or "✕ Close", and the Esc key;
 * - `finish`: the button of the last card.
 */
export type IntroControl = 'next' | 'back' | 'corner' | 'finish';

/** Where a control leads: to another card, out to the menu, or nowhere. */
export type IntroMove = { to: 'card'; card: IntroCard } | { to: 'menu' } | { to: 'stay' };

/** The big button under the cards: its words, and the small line under it, if any. */
export interface ForwardButton {
  label: string;
  note: string | null;
}

const LAST_CARD = INTRO_CARD_COUNT as IntroCard;
const STAY: IntroMove = { to: 'stay' };
const TO_MENU: IntroMove = { to: 'menu' };

/** The labels of the intro's buttons. */
export const INTRO_LABELS = {
  next: 'Next →',
  back: '← Back',
  skip: 'Skip',
  close: '✕ Close',
  toCamera: 'Turn on the camera →',
  toMenu: 'To the menu →',
  /** Under "Turn on the camera →" only: the browser's question comes right after it. */
  cameraNote: 'Your browser asks next. Choose Allow.',
} as const;

const toCard = (card: number): IntroMove => ({ to: 'card', card: card as IntroCard });

/**
 * True when the page opens on the intro, not on the menu. The URL decides when it names
 * `intro=`. Otherwise a visitor who has not seen the intro gets it, when the game would ask
 * for the camera and no test skips the menu: the intro is there to come before that question.
 */
export function introAtLoad(options: Pick<Options, 'intro' | 'input' | 'autostart' | 'settings'>): boolean {
  if (options.intro !== undefined) return options.intro;
  return !options.settings.introSeen && options.input === 'camera' && !options.autostart;
}

/**
 * Where a control leads from the open card. "Next" and "Back" step through the cards and stop
 * at the ends. The corner skips to the last card on a first visit, so the camera card is never
 * skipped, and closes the intro when it came from the menu. The button of the last card leaves.
 */
export function introMove(state: IntroState, control: IntroControl): IntroMove {
  switch (control) {
    case 'next':
      return state.card < LAST_CARD ? toCard(state.card + 1) : STAY;
    case 'back':
      return state.card > 1 ? toCard(state.card - 1) : STAY;
    case 'corner':
      if (state.origin === 'menu') return TO_MENU;
      return state.card < LAST_CARD ? toCard(LAST_CARD) : STAY;
    case 'finish':
      return state.card === LAST_CARD ? TO_MENU : STAY;
  }
}

/**
 * The control of a key in the intro, or null for a key the intro does not use. The caller
 * leaves a key to a focused control first, as the menu does.
 */
export function introControlOfKey(key: string): IntroControl | null {
  if (key === 'arrowright' || key === 'enter' || key === ' ') return 'next';
  if (key === 'arrowleft') return 'back';
  if (key === 'escape') return 'corner';
  return null;
}

/** The words of the corner button, or null where it does not show: the last card of a first visit. */
export function cornerLabel(state: IntroState): string | null {
  if (state.origin === 'menu') return INTRO_LABELS.close;
  return state.card < LAST_CARD ? INTRO_LABELS.skip : null;
}

/** True where "← Back" shows: on every card but the first. */
export function canGoBack(card: IntroCard): boolean {
  return card > 1;
}

/**
 * The big button under the cards is "Next →", and on the last card the button that leaves.
 * It is one button, in one place: a fist that chose "Next" must open before it can choose again.
 */
export function forwardControl(card: IntroCard): IntroControl {
  return card === LAST_CARD ? 'finish' : 'next';
}

/**
 * What the big button says. On the last card it says what comes next: the browser's question
 * for the camera, when the menu will ask for it, else the menu.
 * `cameraNext`: see `menuAsksForCamera`.
 */
export function forwardButton(card: IntroCard, cameraNext: boolean): ForwardButton {
  if (card !== LAST_CARD) return { label: INTRO_LABELS.next, note: null };
  if (!cameraNext) return { label: INTRO_LABELS.toMenu, note: null };
  return { label: INTRO_LABELS.toCamera, note: INTRO_LABELS.cameraNote };
}

/**
 * True when the menu asks for the camera as it opens: hand control is on, the input is the
 * camera, and no input is open yet. See `syncMenuInput` in flow.ts.
 */
export function menuAsksForCamera(settings: Pick<Settings, 'handControl'>, input: InputSource, inputOpen: boolean): boolean {
  return settings.handControl && input === 'camera' && !inputOpen;
}
