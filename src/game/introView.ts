import { HAND_MENU } from './config';
import { find } from './dom';
import { canGoBack, cornerLabel, forwardButton, forwardControl, INTRO_CARD_COUNT, INTRO_LABELS } from './intro';
import type { ForwardButton, IntroCard, IntroControl, IntroState } from './intro';
import { beatPicture, readyPicture, standPicture } from './introPictures';
import { bindRadios, STAND_HINT } from './menuView';
import type { Settings } from './settings';
import type { PlayerCount } from './types';

/**
 * The page of the "How to play" intro: its four cards, the buttons under them and the button
 * in the corner. intro.ts has its rules, and flow.ts runs it.
 *
 * The cards lie on top of each other, and only the open one shows. So the panel is as large as
 * the largest card on every card, and the buttons under the cards never move.
 */

/** The eyebrow of a card: where the player is in the intro. */
const eyebrow = (card: IntroCard): string => `<div class="eyebrow">HOW TO PLAY · ${card} of ${INTRO_CARD_COUNT}</div>`;

/** One card, with its title over its content. */
function card(index: IntroCard, title: string, content: string): string {
  return `
    <section class="intro-card" data-card="${index}" aria-labelledby="intro-title-${index}">
      ${eyebrow(index)}
      <h1 id="intro-title-${index}">${title}</h1>
      <div class="intro-body">${content}</div>
    </section>`;
}

/** A row with a sign at its left. The sign only repeats the text, so assistive tech skips it. */
const row = (sign: string, text: string): string =>
  `<li><span class="intro-sign" aria-hidden="true">${sign}</span><span>${text}</span></li>`;

const BEAT_CARD = card(
  1,
  'Catch the beat with your hands',
  `<div class="intro-picture">${beatPicture()}</div>
  <div class="intro-text">
    <p>A block grows in one cell of your grid. Put a hand in that cell when the block fills it.</p>
    <p class="intro-small">Right on the beat is a Perfect.</p>
  </div>`,
);

/**
 * The player choice looks as the menu's does. Its items are hand targets only while this card
 * is open: `data-card-hand` holds the id, and `show` hands it to `data-hand` (see `openCard`).
 */
const STAND_CARD = card(
  2,
  'Find your spot',
  `<div class="intro-picture" id="intro-stand-picture"></div>
  <div class="intro-text">
    <p>Step back until the camera sees your head and both arms at full stretch.</p>
    <p>A big screen helps. A TV is best.</p>
    <fieldset class="choices intro-count">
      <legend>Players</legend>
      <label data-card-hand="intro-count-1">
        <input type="radio" name="intro-count" value="1"><span>1 player</span>
      </label>
      <label data-card-hand="intro-count-2">
        <input type="radio" name="intro-count" value="2"><span>2 players</span>
      </label>
    </fieldset>
    <p class="intro-small" id="intro-stand-hint"></p>
  </div>`,
);

const HANDS_CARD = card(
  3,
  'Your hands run the game',
  `<div class="intro-picture">${readyPicture()}</div>
  <div class="intro-text">
    <ul class="intro-rows">
      ${row('✋ ✊', 'In the menu, point with an open hand. Then hold a fist to choose.')}
      ${row('✋', 'To start a round, hold a hand in the Start cell. It is at the top right of your grid.')}
      ${row(
        '📏',
        'Does the grid not fit you? Hold a hand in the Calibrate cell, at the top left. ' +
          'Then draw big circles with both arms.',
      )}
    </ul>
    <p class="intro-small">The mouse, a touch and the keyboard work too.</p>
  </div>`,
);

/** The camera card has no picture: its three rows are the content. */
const CAMERA_CARD = card(
  4,
  'Your camera picture stays with you',
  `<div class="intro-text intro-wide">
    <ul class="intro-rows">
      ${row('📷', 'The game needs your camera to see your hands.')}
      ${row(
        '🔒',
        'The picture never leaves this device. ' +
          'The game finds your hands, and your face when Faces is on, right here in your browser.',
      )}
      ${row(
        '🔴',
        'Recording is off until you turn it on. A recorded round stays on this device. ' +
          'The game deletes it when you leave the results, so download it there to keep it.',
      )}
    </ul>
  </div>`,
);

/**
 * The intro's content. It scales with the window as one piece, as the menu does. The big button
 * is "Next →" on cards 1 to 3 and the way out on card 4: one button in one place (see
 * `forwardControl` in intro.ts). The line under it keeps its room on every card.
 */
export const INTRO_HTML = `
  <div class="intro-cards">${BEAT_CARD}${STAND_CARD}${HANDS_CARD}${CAMERA_CARD}</div>
  <div class="intro-dots" aria-hidden="true">${'<span></span>'.repeat(INTRO_CARD_COUNT)}</div>
  <div class="intro-actions">
    <button type="button" id="intro-back" data-hand="intro-back">${INTRO_LABELS.back}</button>
    <button type="button" class="primary" id="intro-forward" data-hand="intro-forward">${INTRO_LABELS.next}</button>
  </div>
  <p class="intro-note" id="intro-note"></p>`;

/**
 * The corner button, "Skip" or "✕ Close": in the top right corner, where the menu has its
 * switches. Not in the top left: a fist that chose "How to play" there would choose it next.
 */
export const INTRO_CORNER_HTML = `
  <div class="corner">
    <button type="button" id="intro-corner" data-hand="intro-corner"></button>
  </div>`;

/** What the intro tells the game. */
export interface IntroHandlers {
  /** A button of the intro was pressed. */
  onControl: (control: IntroControl) => void;
  /** The player choice changed. The intro has written it into the settings by then. */
  onChange: () => void;
}

/** What the intro shows: its state, and whether the menu asks for the camera next (see `menuAsksForCamera`). */
export interface IntroScreen {
  state: IntroState;
  cameraNext: boolean;
}

/** What the page can do with the intro once it is built. */
export interface IntroControls {
  /** Shows the card of `screen.state`, with the buttons of that card. */
  show: (screen: IntroScreen) => void;
}

/**
 * The player choice of card 2. It shows the kept count, and a choice writes the new count into
 * `settings`, then calls `onChange`. The stand hint and the picture follow the count.
 */
export function bindPlayerChoice(root: ParentNode, settings: Settings, onChange: () => void): void {
  const hint = find(root, '#intro-stand-hint');
  const picture = find(root, '#intro-stand-picture');
  const showCount = (): void => {
    hint.textContent = STAND_HINT[settings.playerCount];
    picture.innerHTML = standPicture(settings.playerCount);
  };
  showCount();
  bindRadios(root, 'intro-count', String(settings.playerCount), (value) => {
    settings.playerCount = Number(value) as PlayerCount;
    showCount();
    onChange();
  });
}

/**
 * Shows or hides a card. The hand targets in a card hold their id in `data-card-hand`. They get
 * a `data-hand` only while their card is open: the page lists every `data-hand` in the panel as
 * a target, also one that is not seen.
 */
function openCard(element: HTMLElement, isOpen: boolean): void {
  element.classList.toggle('open', isOpen);
  for (const target of element.querySelectorAll<HTMLElement>('[data-card-hand]')) {
    if (isOpen) target.dataset.hand = target.dataset.cardHand;
    else delete target.dataset.hand;
  }
}

/**
 * Gives a button that leaves a screen the longer fist hold, as the menu's Start button has, and
 * any other button the usual one.
 */
function setHold(button: HTMLElement, leaves: boolean): void {
  if (leaves) button.dataset.handHold = String(HAND_MENU.slowHoldSec);
  else delete button.dataset.handHold;
}

/**
 * Builds the intro in `panel`, which holds INTRO_HTML and INTRO_CORNER_HTML. Each button tells
 * `onControl` what it does on the card that shows. Call `show` to show a card.
 */
export function buildIntro(panel: HTMLElement, settings: Settings, handlers: IntroHandlers): IntroControls {
  const cards = [...panel.querySelectorAll<HTMLElement>('.intro-card')];
  const dots = [...panel.querySelectorAll<HTMLElement>('.intro-dots span')];
  const back = find<HTMLButtonElement>(panel, '#intro-back');
  const forward = find<HTMLButtonElement>(panel, '#intro-forward');
  const note = find(panel, '#intro-note');
  const corner = find<HTMLButtonElement>(panel, '#intro-corner');
  let shownCard: IntroCard = 1;

  bindPlayerChoice(panel, settings, handlers.onChange);
  back.addEventListener('click', () => handlers.onControl('back'));
  forward.addEventListener('click', () => handlers.onControl(forwardControl(shownCard)));
  corner.addEventListener('click', () => handlers.onControl('corner'));

  /** "← Back" keeps its room where it does not show, so the big button stays in its place. */
  const showBack = (isOn: boolean): void => {
    back.classList.toggle('unseen', !isOn);
    if (isOn) back.dataset.hand = 'intro-back';
    else delete back.dataset.hand;
  };
  const showForward = (button: ForwardButton, leaves: boolean): void => {
    forward.textContent = button.label;
    setHold(forward, leaves);
    note.textContent = button.note ?? '';
  };
  const showCorner = (text: string | null, leaves: boolean): void => {
    corner.hidden = text === null;
    corner.textContent = text ?? '';
    if (text === null) delete corner.dataset.hand;
    else corner.dataset.hand = 'intro-corner';
    setHold(corner, leaves);
  };

  const show = ({ state, cameraNext }: IntroScreen): void => {
    shownCard = state.card;
    cards.forEach((element, index) => openCard(element, index + 1 === state.card));
    dots.forEach((dot, index) => dot.classList.toggle('on', index + 1 === state.card));
    showBack(canGoBack(state.card));
    showForward(forwardButton(state.card, cameraNext), forwardControl(state.card) === 'finish');
    showCorner(cornerLabel(state), state.origin === 'menu');
  };
  return { show };
}
