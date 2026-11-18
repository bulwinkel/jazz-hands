import { describe, expect, it, vi } from 'vitest';
import { introMove } from './intro';
import type { IntroCard, IntroControl, IntroOrigin, IntroState } from './intro';
import { beatPicture, readyPicture, standPicture } from './introPictures';
import { buildIntro, INTRO_CORNER_HTML, INTRO_HTML } from './introView';
import { HOW_TO_PLAY_HTML, STAND_HINT } from './menuView';
import { defaultSettings } from './settings';
import type { Settings } from './settings';

/** The text of each card, as the page must show it. */
const CARD_TEXTS: Record<IntroCard, string[]> = {
  1: [
    'Catch the beat with your hands',
    'A block grows in one cell of your grid. Put a hand in that cell when the block fills it.',
    'Right on the beat is a Perfect.',
  ],
  2: [
    'Find your spot',
    'Step back until the camera sees your head and both arms at full stretch.',
    'A big screen helps. A TV is best.',
    'Players',
    '1 player',
    '2 players',
  ],
  3: [
    'Your hands run the game',
    'In the menu, point with an open hand. Then hold a fist to choose.',
    'To start a round, hold a hand in the Start cell. It is at the top right of your grid.',
    'Does the grid not fit you? Hold a hand in the Calibrate cell, at the top left. ' +
      'Then draw big circles with both arms.',
    'The mouse, a touch and the keyboard work too.',
  ],
  4: [
    'Your camera picture stays with you',
    'The game needs your camera to see your hands.',
    'The picture never leaves this device. ' +
      'The game finds your hands, and your face when Faces is on, right here in your browser.',
    'Recording is off until you turn it on. A recorded round stays on this device. ' +
      'The game deletes it when you leave the results, so download it there to keep it.',
  ],
};

/** The markup of one card, from its opening tag to the next card's. */
function cardHtml(card: IntroCard): string {
  const start = INTRO_HTML.indexOf(`data-card="${card}"`);
  const end = card < 4 ? INTRO_HTML.indexOf(`data-card="${card + 1}"`) : INTRO_HTML.indexOf('intro-dots');
  return INTRO_HTML.slice(start, end);
}

describe('the cards of the intro', () => {
  it('hold their texts as written, in order', () => {
    for (const card of [1, 2, 3, 4] as const) {
      const html = cardHtml(card);
      let from = 0;
      for (const text of CARD_TEXTS[card]) {
        const at = html.indexOf(text, from);
        expect(at, `card ${card}: ${text}`).toBeGreaterThan(-1);
        from = at + text.length;
      }
    }
  });

  it('each have the eyebrow of their place in the intro', () => {
    for (const card of [1, 2, 3, 4] as const) expect(cardHtml(card)).toContain(`HOW TO PLAY · ${card} of 4`);
  });

  it('put the signs at the left of the rows of cards 3 and 4', () => {
    const signs = (card: IntroCard): string[] =>
      [...cardHtml(card).matchAll(/class="intro-sign"[^>]*>([^<]+)</g)].map((match) => match[1]);
    expect(signs(3)).toEqual(['✋ ✊', '✋', '📏']);
    expect(signs(4)).toEqual(['📷', '🔒', '🔴']);
  });

  it('show the pictures of cards 1 and 3, a place for the picture of card 2, and none on card 4', () => {
    expect(cardHtml(1)).toContain(beatPicture());
    expect(cardHtml(2)).toContain('id="intro-stand-picture"');
    expect(cardHtml(3)).toContain(readyPicture());
    expect(cardHtml(4)).not.toContain('intro-picture');
    expect(cardHtml(4)).not.toContain('<svg');
  });

  it('give each title the focus of the page only, not of the Tab key', () => {
    for (const card of [1, 2, 3, 4] as const) {
      expect(cardHtml(card)).toContain(`id="intro-title-${card}" tabindex="-1"`);
    }
  });

  it('describe the big button by the line under it', () => {
    expect(INTRO_HTML).toMatch(/id="intro-forward"[^>]*aria-describedby="intro-note"/);
    expect(INTRO_HTML).toContain('id="intro-note"');
  });

  it('make every button of the intro a hand target', () => {
    expect(INTRO_HTML).toMatch(/id="intro-back" data-hand="intro-back"/);
    expect(INTRO_HTML).toMatch(/id="intro-forward" data-hand="intro-forward"/);
    expect(INTRO_CORNER_HTML).toMatch(/id="intro-corner" data-hand="intro-corner"/);
    expect(cardHtml(2).match(/data-card-hand="intro-count-[12]"/g)).toHaveLength(2);
  });
});

describe('the menu\'s way to the intro', () => {
  it('is a hand target in the top left corner, with the look of the switches', () => {
    expect(HOW_TO_PLAY_HTML).toContain('class="corner left"');
    expect(HOW_TO_PLAY_HTML).toMatch(/data-hand="how-to-play"\s/);
    expect(HOW_TO_PLAY_HTML).toContain('>❓ How to play<');
  });

  it('takes the longer fist hold: it leaves the menu', () => {
    expect(HOW_TO_PLAY_HTML).toContain('data-hand-hold="0.8"');
  });
});

// --- The intro at work, on stand-ins for the page: the tests run without one ---

type Listener = () => void;

/** An element with what the intro uses: text, classes, data, hidden, events and queries. */
class FakeElement {
  hidden = false;
  readonly focus = vi.fn();
  readonly blur = vi.fn();
  textContent = '';
  innerHTML = '';
  value = '';
  checked = false;
  readonly dataset: Record<string, string | undefined> = {};
  private readonly classes = new Set<string>();
  readonly classList = {
    toggle: (name: string, force?: boolean): boolean => {
      const on = force ?? !this.classes.has(name);
      if (on) this.classes.add(name);
      else this.classes.delete(name);
      return on;
    },
    contains: (name: string): boolean => this.classes.has(name),
  };
  private readonly listeners = new Map<string, Listener[]>();
  private readonly parts = new Map<string, FakeElement[]>();

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  fire(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
  click(): void {
    this.fire('click');
  }
  /** Answers `selector` with these elements from now on. */
  holds(selector: string, ...elements: FakeElement[]): this {
    this.parts.set(selector, elements);
    return this;
  }
  querySelector(selector: string): FakeElement | null {
    return this.parts.get(selector)?.[0] ?? null;
  }
  querySelectorAll(selector: string): FakeElement[] {
    return this.parts.get(selector) ?? [];
  }
}

/** A radio input of the player choice. */
function radio(value: string): FakeElement {
  const input = new FakeElement();
  input.value = value;
  return input;
}

/** Picks a radio input, as a click does: it is checked, and the others of its group are not. */
function pick(inputs: FakeElement[], index: number): void {
  inputs.forEach((input, k) => (input.checked = k === index));
  inputs[index].fire('change');
}

/** The parts of the intro's page, and every control it told the game. */
function intro(settings: Settings = defaultSettings()) {
  const choices = ['intro-count-1', 'intro-count-2'].map((id) => {
    const label = new FakeElement();
    label.dataset.cardHand = id;
    return label;
  });
  const titles = [1, 2, 3, 4].map(() => new FakeElement());
  const cards = [1, 2, 3, 4].map((card) =>
    new FakeElement().holds('[data-card-hand]', ...(card === 2 ? choices : [])).holds('h1', titles[card - 1]),
  );
  const dots = [1, 2, 3, 4].map(() => new FakeElement());
  const [back, forward, note, corner, hint, picture] = Array.from({ length: 6 }, () => new FakeElement());
  const inputs = [radio('1'), radio('2')];
  const panel = new FakeElement()
    .holds('.intro-card', ...cards)
    .holds('.intro-dots span', ...dots)
    .holds('#intro-back', back)
    .holds('#intro-forward', forward)
    .holds('#intro-note', note)
    .holds('#intro-corner', corner)
    .holds('#intro-stand-hint', hint)
    .holds('#intro-stand-picture', picture)
    .holds('input[name="intro-count"]', ...inputs);
  const controls: IntroControl[] = [];
  const onChange = vi.fn();
  const view = buildIntro(panel as unknown as HTMLElement, settings, {
    onControl: (control) => controls.push(control),
    onChange,
  });
  const show = (origin: IntroOrigin, card: IntroCard, cameraNext = true) =>
    view.show({ state: { origin, card }, cameraNext });
  const parts = { cards, titles, choices, dots, back, forward, note, corner, hint, picture, inputs, view };
  return { ...parts, settings, controls, onChange, show };
}

describe('the intro at work', () => {
  it('shows only the open card, with its dot', () => {
    const page = intro();
    page.show('first-visit', 3);
    expect(page.cards.map((card) => card.classList.contains('open'))).toEqual([false, false, true, false]);
    expect(page.dots.map((dot) => dot.classList.contains('on'))).toEqual([false, false, true, false]);
  });

  it('makes the player choice a hand target only while card 2 is open', () => {
    const page = intro();
    page.show('first-visit', 1);
    expect(page.choices.map((label) => label.dataset.hand)).toEqual([undefined, undefined]);
    page.show('first-visit', 2);
    expect(page.choices.map((label) => label.dataset.hand)).toEqual(['intro-count-1', 'intro-count-2']);
    page.show('first-visit', 3);
    expect(page.choices.map((label) => label.dataset.hand)).toEqual([undefined, undefined]);
  });

  it('keeps Back off card 1, out of sight and out of reach of a hand', () => {
    const page = intro();
    page.show('first-visit', 2);
    expect(page.back.classList.contains('unseen')).toBe(false);
    expect(page.back.dataset.hand).toBe('intro-back');
    page.show('first-visit', 1);
    expect(page.back.classList.contains('unseen')).toBe(true);
    expect(page.back.dataset.hand).toBeUndefined();
  });

  it('shows Skip in the corner on a first visit, but not on the last card', () => {
    const page = intro();
    page.show('first-visit', 1);
    expect(page.corner).toMatchObject({ hidden: false, textContent: 'Skip' });
    expect(page.corner.dataset.hand).toBe('intro-corner');
    page.show('first-visit', 4);
    expect(page.corner.hidden).toBe(true);
    expect(page.corner.dataset.hand).toBeUndefined();
  });

  it('shows Close in the corner on every card when the intro came from the menu, with the longer hold', () => {
    const page = intro();
    for (const card of [1, 2, 3, 4] as const) {
      page.show('menu', card);
      expect(page.corner).toMatchObject({ hidden: false, textContent: '✕ Close' });
      expect(page.corner.dataset.handHold).toBe('0.8');
    }
  });

  it('labels the big button Next on cards 1 to 3, with no line under it', () => {
    const page = intro();
    for (const card of [1, 2, 3] as const) {
      page.show('first-visit', card);
      expect(page.forward.textContent).toBe('Next →');
      expect(page.forward.dataset.handHold).toBeUndefined();
      expect(page.note.textContent).toBe('');
    }
  });

  it('labels the big button of card 4 by what comes next, with the browser line only for the camera', () => {
    const page = intro();
    page.show('first-visit', 4, true);
    expect(page.forward.textContent).toBe('Turn on the camera →');
    expect(page.note.textContent).toBe('If your browser asks, choose Allow.');
    expect(page.forward.dataset.handHold).toBe('0.8');
    page.show('menu', 4, false);
    expect(page.forward.textContent).toBe('To the menu →');
    expect(page.note.textContent).toBe('');
  });

  it('tells the game what each button does on the card that shows', () => {
    const page = intro();
    page.show('first-visit', 1);
    page.forward.click();
    page.show('first-visit', 3);
    page.forward.click();
    page.back.click();
    page.corner.click();
    page.show('first-visit', 4);
    page.forward.click();
    expect(page.controls).toEqual(['next', 'next', 'back', 'corner', 'finish']);
  });
});

describe('the focus in the intro', () => {
  /**
   * Presses a button of the intro, and shows the card it leads to, as flow.ts does. `state`
   * holds the intro's state, and changes with it.
   */
  function pressAndShow(page: ReturnType<typeof intro>, state: { now: IntroState }, button: FakeElement): void {
    button.click();
    const move = introMove(state.now, page.controls.at(-1) ?? 'next', 10);
    if (move.to !== 'card') return;
    state.now = { ...state.now, card: move.card };
    page.view.show({ state: state.now, cameraNext: true });
  }

  const focusCounts = (page: ReturnType<typeof intro>) => page.titles.map((title) => title.focus.mock.calls.length);

  it('goes to the title of the first card when the intro opens', () => {
    const page = intro();
    page.show('first-visit', 1);
    expect(focusCounts(page)).toEqual([1, 0, 0, 0]);
  });

  it('goes to the title of each card that opens, by Next, Back and Skip', () => {
    const page = intro();
    const state = { now: { origin: 'first-visit', card: 1 } as IntroState };
    page.view.show({ state: state.now, cameraNext: true });
    pressAndShow(page, state, page.forward);
    expect(focusCounts(page)).toEqual([1, 1, 0, 0]);
    pressAndShow(page, state, page.back);
    expect(focusCounts(page)).toEqual([2, 1, 0, 0]);
    pressAndShow(page, state, page.corner);
    expect(focusCounts(page)).toEqual([2, 1, 0, 1]);
  });

  it('stays where it is when the open card shows again with a new label', () => {
    const page = intro();
    page.show('menu', 4, false);
    page.show('menu', 4, true);
    expect(focusCounts(page)).toEqual([0, 0, 0, 1]);
  });
});

describe('the player choice of card 2', () => {
  it('lets go of the focus after a pointer press, so the arrow keys step through the cards', () => {
    const page = intro();
    page.inputs[0].fire('pointerdown');
    pick(page.inputs, 0);
    page.inputs[0].fire('click');
    expect(page.inputs[0].blur).toHaveBeenCalledTimes(1);
  });

  it('keeps the focus of a choice made with the keys, so the arrows still move between the choices', () => {
    const page = intro();
    pick(page.inputs, 1);
    page.inputs[1].fire('click');
    expect(page.inputs[1].blur).not.toHaveBeenCalled();
  });

  it('shows the kept count, with its stand hint and picture', () => {
    const page = intro({ ...defaultSettings(), playerCount: 1 });
    expect(page.inputs.map((input) => input.checked)).toEqual([true, false]);
    expect(page.hint.textContent).toBe(STAND_HINT[1]);
    expect(page.picture.innerHTML).toBe(standPicture(1));
  });

  it('changes the setting, the stand hint and the picture, and tells the game', () => {
    const page = intro();
    expect(page.settings.playerCount).toBe(2);
    pick(page.inputs, 0);
    expect(page.settings.playerCount).toBe(1);
    expect(page.hint.textContent).toBe(STAND_HINT[1]);
    expect(page.picture.innerHTML).toBe(standPicture(1));
    expect(page.onChange).toHaveBeenCalledTimes(1);
    pick(page.inputs, 1);
    expect(page.settings.playerCount).toBe(2);
    expect(page.hint.textContent).toBe(STAND_HINT[2]);
    expect(page.picture.innerHTML).toBe(standPicture(2));
    expect(page.onChange).toHaveBeenCalledTimes(2);
  });
});
