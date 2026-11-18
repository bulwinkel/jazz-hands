import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrackedHand, TrackingFrame } from '../tracking/types';
import type { HandTarget, MenuHand } from './handMenu';
import { forwardControl } from './intro';
import type { IntroControl } from './intro';
import type { IntroHandlers, IntroScreen } from './introView';
import type { MenuHandlers } from './menuView';
import type { ItemHover } from './playerPointers';
import { STORAGE_KEY } from './settings';
import type { Settings } from './settings';

/**
 * The game's flow at page load and around the "How to play" intro. The flow is real, and so is
 * the host that opens the input. The page, the canvas and the song preview are stand-ins, and
 * so is the input: `createInput` is where the browser would be asked for the camera. The page
 * clock is a stand-in too, so a test says how much time passes.
 */

const fakes = vi.hoisted(() => {
  /** A button of the page: whether it shows, and what a click on it calls. */
  class FakeButton {
    hidden = true;
    textContent = '';
    private readonly listeners: Array<() => void> = [];
    addEventListener(_type: string, listener: () => void): void {
      this.listeners.push(listener);
    }
    click(): void {
      for (const listener of this.listeners) listener();
    }
  }

  /** The page: it keeps which panel shows, and what the game handed the menu and the intro. */
  class FakeUI {
    static last: FakeUI;
    /** The camera picture fills a 1600 by 900 stage: a hand at (0.5, 0.5) is at (800, 450). */
    readonly stage = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1600, height: 900 }) };
    readonly canvas = {};
    readonly debug = { hidden: true, textContent: '' };
    readonly pauseButton = new FakeButton();
    readonly restartButton = new FakeButton();
    readonly menuButton = new FakeButton();
    readonly resumeButton = new FakeButton();
    readonly fullscreenButton = new FakeButton();
    readonly player = { onChange: () => {}, isOpen: false, close: () => {}, isOwnControl: () => false };
    readonly message = undefined;
    readonly handScreen = '';
    panel = 'none';
    menuHandlers?: MenuHandlers;
    introHandlers?: IntroHandlers;
    /** Every intro screen the game showed, the latest last. */
    readonly introScreens: IntroScreen[] = [];
    /** The items a hand can choose, for each panel. */
    targets: Record<string, HandTarget[]> = {};
    /** Every item that a hand chose, in order, and what choosing it does. */
    readonly chosen: string[] = [];
    onChoose: (id: string) => void = () => {};
    /** The hands and the highlights of the last frame. */
    hands: MenuHand[] = [];
    hovers: ItemHover[] = [];
    readonly toasts: string[] = [];
    readonly focusHowToPlay = vi.fn();

    constructor() {
      FakeUI.last = this;
    }
    showMenu(_settings: unknown, handlers: MenuHandlers): void {
      this.panel = 'menu';
      this.menuHandlers = handlers;
    }
    showIntro(_settings: unknown, screen: IntroScreen, handlers: IntroHandlers): void {
      this.panel = 'intro';
      this.introHandlers = handlers;
      this.introScreens.push(screen);
    }
    showIntroCard(screen: IntroScreen): void {
      this.introScreens.push(screen);
    }
    hidePanel(): void {
      this.panel = 'none';
    }
    showMessage(): void {}
    showToast(text: string): void {
      this.toasts.push(text);
    }
    showHands(hands: MenuHand[], hovers: ItemHover[]): void {
      this.hands = hands;
      this.hovers = hovers;
    }
    handTargets(): HandTarget[] {
      return this.targets[this.panel] ?? [];
    }
    chooseHandTarget(id: string): void {
      this.chosen.push(id);
      this.onChoose(id);
    }
    showRecordingMark(): void {}
    showRecordings(): void {}
    stepSong(): void {}
    updateHold(): void {}
  }

  class FakeRenderer {
    readonly framePixels = { x: 0, y: 0, width: 1, height: 1 };
    draw(): void {}
  }

  /** The song preview of the menu: it keeps what the game asked it to play. */
  class FakePreview {
    static last: FakePreview;
    readonly follow = vi.fn();
    readonly state = { url: null, playing: false, timeSec: 0, volume: 0 };
    constructor() {
      FakePreview.last = this;
    }
    dispose(): void {}
  }

  /** The input that the host opens: it opens at once, and keeps its tracker switches. */
  const input = {
    mode: 'hands-full',
    delegate: 'fake',
    init: vi.fn(async () => {}),
    start: vi.fn(),
    setMode: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
  const createInput = vi.fn(() => input);
  return { FakeUI, FakeRenderer, FakePreview, input, createInput };
});

vi.mock('./ui', () => ({ GameUI: fakes.FakeUI }));
vi.mock('./render', () => ({ GameRenderer: fakes.FakeRenderer }));
vi.mock('./preview', () => ({ MenuPreview: fakes.FakePreview }));
vi.mock('./input', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./input')>()),
  createInput: fakes.createInput,
}));

// The flow must load after the stand-ins are in place.
const { DanceGame } = await import('./flow');

type KeyTarget = { tagName: string };

/** Keys held with a key: Alt, Ctrl and Cmd. */
type Modifiers = Partial<Record<'altKey' | 'ctrlKey' | 'metaKey', boolean>>;

/** One tracking frame every this many milliseconds, as a camera at 30 frames per second. */
const FRAME_MS = 33;

/** A hand at a place in the camera frame, in fractions. */
const hand = (x: number, y: number, fist: boolean): TrackedHand => ({
  x,
  y,
  size: 0.05,
  gesture: fist ? 'fist' : 'open',
  gestureScore: 1,
});

/**
 * Loads the page with `stored` settings in storage and `query` as the URL. Returns the parts a
 * test reads, and ways to press a key, to let time pass, to draw a frame, to send a tracking
 * frame and to wait for the input to open.
 */
function loadPage(query = '', stored: Partial<Settings> | null = null) {
  let nowMs = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  let drawFrame: FrameRequestCallback = () => {};
  const storage = new Map<string, string>();
  if (stored) storage.set(STORAGE_KEY, JSON.stringify(stored));
  const keyListeners: Array<(event: KeyboardEvent) => void> = [];
  const fakeWindow: Record<string, unknown> = {
    addEventListener: (type: string, listener: (event: KeyboardEvent) => void) => {
      if (type === 'keydown') keyListeners.push(listener);
    },
    removeEventListener: () => {},
    setTimeout,
    clearTimeout,
  };
  const requestFullscreen = vi.fn(async () => {});
  vi.stubGlobal('window', fakeWindow);
  vi.stubGlobal('document', {
    addEventListener: () => {},
    fullscreenEnabled: true,
    fullscreenElement: null,
    documentElement: { requestFullscreen },
    body: { dataset: {} },
  });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal('location', { search: query });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    drawFrame = callback;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});

  new DanceGame({} as HTMLElement);
  const ui = fakes.FakeUI.last;

  /**
   * Presses a key, on `target` when a control has the focus, with `modifiers` held. Answers
   * whether the game took the key from the browser.
   */
  const press = (key: string, target: KeyTarget = { tagName: 'BODY' }, modifiers: Modifiers = {}): boolean => {
    const preventDefault = vi.fn();
    const event = { key, repeat: false, target, preventDefault, ...modifiers } as unknown as KeyboardEvent;
    for (const listener of keyListeners) listener(event);
    return preventDefault.mock.calls.length > 0;
  };
  const advance = (ms: number): void => {
    nowMs += ms;
  };
  /** Sends a tracking frame with each player's hands, a frame later than the last. */
  const track = (first: TrackedHand[], second: TrackedHand[] = []): void => {
    advance(FRAME_MS);
    const onFrame = fakes.input.start.mock.calls.at(-1)?.[1] as (frame: TrackingFrame) => void;
    onFrame({ timeMs: nowMs, inferenceMs: 1, players: [{ hands: first }, { hands: second }] });
  };
  /** Sends the same hands for `durationMs`. */
  const trackFor = (durationMs: number, first: TrackedHand[], second: TrackedHand[] = []): void => {
    for (let passed = 0; passed < durationMs; passed += FRAME_MS) track(first, second);
  };
  /** Tracking breaks, as the open input reports it. */
  const breakTracking = (): void => {
    const onError = fakes.input.start.mock.calls.at(-1)?.[2] as (error: unknown) => void;
    onError(new Error('The tracker stopped.'));
  };
  /** The kept settings now, or null when nothing is kept. */
  const kept = (): Settings | null => {
    const json = storage.get(STORAGE_KEY);
    return json ? JSON.parse(json) : null;
  };
  const control = (intro: IntroControl) => ui.introHandlers?.onControl(intro);
  return {
    ui,
    press,
    kept,
    requestFullscreen,
    advance,
    track,
    trackFor,
    breakTracking,
    drawFrame: () => drawFrame(nowMs),
    phase: () => (fakeWindow.__dance as { phase: string }).phase,
    screen: () => ui.introScreens.at(-1),
    control,
    /** Presses the button of card 4 once that card has been open long enough. */
    finish: () => {
      advance(700);
      control('finish');
    },
  };
}

type Page = ReturnType<typeof loadPage>;

/** Makes a hand's choice of an intro button press it, as a click on the page would. */
function clickIntroByHand(page: Page): void {
  const pressFor: Record<string, () => IntroControl> = {
    'intro-forward': () => forwardControl(page.screen()?.state.card ?? 1),
    'intro-back': () => 'back',
    'intro-corner': () => 'corner',
  };
  page.ui.onChoose = (id) => {
    const control = pressFor[id];
    if (control) page.control(control());
  };
}

/** Lets the input's opening finish: its `init` resolves at once. */
const settle = () => new Promise((done) => setTimeout(done, 0));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('the camera on a first visit', () => {
  it('is not asked for while the intro shows, and is asked for after the button of card 4', async () => {
    const page = loadPage();
    expect(page.phase()).toBe('intro');
    expect(page.screen()).toEqual({ state: { origin: 'first-visit', card: 1 }, cameraNext: true });

    // Every way through the cards, and the player choice, leaves the camera closed.
    page.press('ArrowRight');
    page.ui.introHandlers?.onChange();
    page.press('Escape');
    page.press('ArrowLeft');
    page.press('Enter');
    expect(page.screen()?.state.card).toBe(4);
    await settle();
    expect(fakes.createInput).not.toHaveBeenCalled();

    page.finish();
    expect(page.phase()).toBe('menu');
    await settle();
    expect(fakes.createInput).toHaveBeenCalledTimes(1);
    const cameraOptions = expect.objectContaining({ input: 'camera' });
    expect(fakes.createInput).toHaveBeenCalledWith(cameraOptions, 'hands-full', false, page.ui.stage);
  });

  it('is asked for at once when the kept settings say the intro was seen', async () => {
    const page = loadPage('', { introSeen: true });
    expect(page.phase()).toBe('menu');
    await settle();
    expect(fakes.createInput).toHaveBeenCalledTimes(1);
  });

  it('is not asked for after the intro either with hand control off, and card 4 says so', async () => {
    const page = loadPage('?hands=0');
    page.press('Escape');
    expect(page.screen()).toEqual({ state: { origin: 'first-visit', card: 4 }, cameraNext: false });
    page.finish();
    await settle();
    expect(page.phase()).toBe('menu');
    expect(fakes.createInput).not.toHaveBeenCalled();
  });

  it('waits for the intro that intro=1 shows with the mouse too', async () => {
    const page = loadPage('?intro=1&input=mouse', { introSeen: true });
    expect(page.phase()).toBe('intro');
    expect(page.screen()?.cameraNext).toBe(false);
    await settle();
    expect(fakes.createInput).not.toHaveBeenCalled();
    page.press('Escape');
    page.finish();
    await settle();
    expect(fakes.createInput).toHaveBeenCalledTimes(1);
  });

  it('is not asked for with intro=1&autostart=1: the intro stays, and no round starts', async () => {
    const page = loadPage('?intro=1&autostart=1');
    await settle();
    expect(page.phase()).toBe('intro');
    expect(fakes.createInput).not.toHaveBeenCalled();
  });
});

describe('the intro opened from the menu', () => {
  /** A page on the menu with the camera open, then the intro from the menu's button. */
  async function introFromMenu(kept: Partial<Settings> = { introSeen: true }) {
    const page = loadPage('', kept);
    await settle();
    page.ui.menuHandlers?.onHowToPlay();
    return page;
  }

  it('opens at card 1, and keeps the camera running so hands can press its buttons', async () => {
    const page = await introFromMenu();
    expect(page.phase()).toBe('intro');
    expect(page.screen()).toEqual({ state: { origin: 'menu', card: 1 }, cameraNext: false });
    expect(fakes.input.dispose).not.toHaveBeenCalled();
  });

  it('closes with the corner or Esc, from any card, and the camera goes on', async () => {
    const page = await introFromMenu();
    page.press('ArrowRight');
    page.control('corner');
    expect(page.phase()).toBe('menu');
    page.ui.menuHandlers?.onHowToPlay();
    page.press('Escape');
    expect(page.phase()).toBe('menu');
    await settle();
    expect(fakes.createInput).toHaveBeenCalledTimes(1);
    expect(fakes.input.dispose).not.toHaveBeenCalled();
  });

  it('leaves by the button of card 4 too', async () => {
    const page = await introFromMenu();
    for (let step = 0; step < 3; step++) page.press('ArrowRight');
    page.finish();
    expect(page.phase()).toBe('menu');
  });
});

describe('the keys of the intro', () => {
  it('step on with →, Enter and Space, and back with ←, but not past the ends', () => {
    const page = loadPage();
    page.press('ArrowLeft');
    expect(page.screen()?.state.card).toBe(1);
    page.press('ArrowRight');
    page.press('Enter');
    page.press(' ');
    expect(page.screen()?.state.card).toBe(4);
    page.press('ArrowRight');
    page.press('Enter');
    expect(page.screen()?.state.card).toBe(4);
    expect(page.phase()).toBe('intro');
    page.press('ArrowLeft');
    expect(page.screen()?.state.card).toBe(3);
  });

  it('skip to card 4 with Esc on a first visit, and do nothing there', () => {
    const page = loadPage();
    page.press('Escape');
    expect(page.screen()?.state.card).toBe(4);
    page.press('Escape');
    expect(page.phase()).toBe('intro');
    expect(page.screen()?.state.card).toBe(4);
  });

  it('leave Space and Enter to a focused button, which the browser then presses', () => {
    const page = loadPage();
    expect(page.press('Enter', { tagName: 'BUTTON' })).toBe(false);
    expect(page.press(' ', { tagName: 'BUTTON' })).toBe(false);
    expect(page.screen()?.state.card).toBe(1);
  });

  it('leave the arrows to a focused player choice', () => {
    const page = loadPage();
    page.press('ArrowRight');
    expect(page.press('ArrowLeft', { tagName: 'INPUT' })).toBe(false);
    expect(page.press('ArrowRight', { tagName: 'INPUT' })).toBe(false);
    expect(page.screen()?.state.card).toBe(2);
  });

  it('do nothing with M, R and C', async () => {
    const page = loadPage('', { introSeen: true });
    await settle();
    page.ui.menuHandlers?.onHowToPlay();
    const switches = fakes.input.setMode.mock.calls.length;
    for (const key of ['m', 'r', 'c']) page.press(key);
    expect(page.phase()).toBe('intro');
    expect(page.screen()?.state.card).toBe(1);
    expect(fakes.input.setMode).toHaveBeenCalledTimes(switches);
  });

  it('let F make the page full screen', () => {
    const page = loadPage();
    page.press('f');
    expect(page.requestFullscreen).toHaveBeenCalledTimes(1);
  });
});

describe('the buttons of a round in the intro', () => {
  it('are hidden, so they do nothing', () => {
    const page = loadPage();
    const { pauseButton, restartButton, menuButton } = page.ui;
    expect([pauseButton.hidden, restartButton.hidden, menuButton.hidden]).toEqual([true, true, true]);
    pauseButton.click();
    restartButton.click();
    expect(page.phase()).toBe('intro');
  });
});

describe('the kept mark of the intro', () => {
  it('is not written by a page load, the cards or the corner', () => {
    const page = loadPage();
    page.press('ArrowRight');
    page.press('Escape');
    page.press('ArrowLeft');
    expect(page.kept()?.introSeen ?? false).toBe(false);
  });

  it('is written by the button of card 4', () => {
    const page = loadPage();
    page.press('Escape');
    page.finish();
    expect(page.kept()?.introSeen).toBe(true);
  });

  it('is written by Close when the intro came from the menu', async () => {
    // The mouse opens on the menu, so this visitor has not seen the intro yet.
    const page = loadPage('?input=mouse');
    expect(page.phase()).toBe('menu');
    page.ui.menuHandlers?.onHowToPlay();
    expect(page.kept()?.introSeen ?? false).toBe(false);
    page.control('corner');
    expect(page.kept()?.introSeen).toBe(true);
  });

  it('is not written by the player choice, which is saved at once', () => {
    const page = loadPage();
    page.press('ArrowRight');
    page.ui.introHandlers?.onChange();
    expect(page.kept()).toMatchObject({ introSeen: false });
  });
});

describe('the song preview in the intro', () => {
  it('does not play on a first visit, and plays once the menu opens', () => {
    const page = loadPage();
    const preview = fakes.FakePreview.last;
    expect(preview.follow.mock.calls.every(([song]) => song === null)).toBe(true);
    page.press('Escape');
    page.finish();
    expect(preview.follow).toHaveBeenLastCalledWith(0);
  });

  it('stops when the intro opens from the menu', () => {
    const page = loadPage('', { introSeen: true });
    const preview = fakes.FakePreview.last;
    expect(preview.follow).toHaveBeenLastCalledWith(0);
    page.ui.menuHandlers?.onHowToPlay();
    expect(preview.follow).toHaveBeenLastCalledWith(null);
  });
});

describe('hands in the intro opened from the menu', () => {
  /** "✕ Close" of the intro and the menu's Previews switch: the same box in the top right corner. */
  const CORNER = { x: 1300, y: 40, width: 236, height: 52 };
  /** A hand on that box, in fractions of the camera frame (the stage is 1600 by 900). */
  const ON_CORNER = { x: 1400 / 1600, y: 66 / 900 };

  async function introByHand() {
    const page = loadPage('', { introSeen: true });
    await settle();
    page.ui.menuHandlers?.onHowToPlay();
    clickIntroByHand(page);
    return page;
  }

  it('point at the intro: a hand moves its ring there', async () => {
    const page = await introByHand();
    page.track([hand(0.5, 0.5, false)]);
    expect(page.ui.hands).toEqual([{ x: 800, y: 450, fist: false }]);
  });

  it('choose Close, and the same fist then does not change the Previews switch in its place', async () => {
    const page = await introByHand();
    page.ui.targets = {
      intro: [{ id: 'intro-corner', rect: CORNER, holdSec: 0.8 }],
      menu: [{ id: 'previews', rect: CORNER, holdSec: 0.5 }],
    };
    page.trackFor(2500, [hand(ON_CORNER.x, ON_CORNER.y, true)]);
    expect(page.phase()).toBe('menu');
    expect(page.ui.chosen).toEqual(['intro-corner']);
    // The spent fist still points: its ring is open, and the switch is highlighted with no hold.
    expect(page.ui.hands).toEqual([{ x: 1400, y: 66, fist: false }]);
    expect(page.ui.hovers).toEqual([{ id: 'previews', progress: 0 }]);
  });

  it('act on one card only when two holds end in one frame', async () => {
    const page = await introByHand();
    page.press('ArrowRight');
    page.ui.targets = {
      intro: [
        { id: 'intro-back', rect: { x: 100, y: 600, width: 300, height: 200 }, holdSec: 0.5 },
        { id: 'intro-forward', rect: { x: 900, y: 600, width: 300, height: 200 }, holdSec: 0.5 },
      ],
    };
    // Player 1 holds Next, player 2 holds Back. Both holds end in the same frame.
    page.trackFor(800, [hand(1000 / 1600, 0.75, true)], [hand(200 / 1600, 0.75, true)]);
    expect(page.ui.chosen).toEqual(['intro-forward']);
    expect(page.screen()?.state.card).toBe(3);
  });
});
