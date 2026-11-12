import { carouselOffset, stepRing } from './carousel';
import { HAND_MENU, LEVELS, PLAYER_COLORS, SONGS } from './config';
import type { HandTarget, MenuHand } from './handMenu';
import type { PlayerRun } from './player';
import { accuracy, stars } from './scoring';
import type { Settings } from './settings';
import type { Level, PlayerCount, PlayerIndex, SongLength } from './types';

const ALL_LEVELS: Level[] = [1, 2, 3, 4, 5];
/** The song carousel shows this many cards on each side of the chosen song. */
const CAROUSEL_REACH = 2;

/**
 * The arrow on a step button, drawn as a picture. A "‹" letter does not sit in the middle of
 * its own line, so it looked low in the button.
 */
const chevron = (points: string): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="${points}" /></svg>`;
const CHEVRON_LEFT = chevron('15.5,5 8.5,12 15.5,19');
const CHEVRON_RIGHT = chevron('8.5,5 15.5,12 8.5,19');

const SHELL_HTML = `
  <main id="stage" aria-label="Dance game">
    <canvas aria-label="Player grids, hand positions and beat cues"></canvas>
  </main>
  <div id="panel"></div>
  <div id="cursors" aria-hidden="true"></div>
  <div id="message" role="status" aria-live="polite"><h1></h1><p></p></div>
  <button id="resume" hidden>Click to start</button>
  <button id="pause" hidden aria-label="Pause game">Ⅱ Pause</button>
  <button id="refit" hidden data-hand="refit" data-hand-hold="${HAND_MENU.slowHoldSec}">↺ Recalibrate · C</button>
  <pre id="debug" hidden></pre>`;

const MENU_HTML = `
  <div class="eyebrow">MOVE TOGETHER · PLAY TOGETHER</div>
  <h1>Kitchen Disco<span>✦</span></h1>
  <p class="subtitle">Reach for the beat. Make a little magic.</p>
  <fieldset class="songs">
    <legend>♫ <span id="song-title"></span><small id="song-count"></small></legend>
    <button type="button" class="song-step" data-hand="song-previous" data-hand-repeat aria-label="Previous song">${CHEVRON_LEFT}</button>
    <div class="song-strip"></div>
    <button type="button" class="song-step" data-hand="song-next" data-hand-repeat aria-label="Next song">${CHEVRON_RIGHT}</button>
  </fieldset>
  <fieldset class="count choices">
    <legend>Players</legend>
    <label data-hand="count-1"><input type="radio" name="count" value="1"><span>1 player</span></label>
    <label data-hand="count-2"><input type="radio" name="count" value="2"><span>2 players</span></label>
  </fieldset>
  <div class="players"></div>
  <fieldset class="length choices">
    <legend>How long shall we dance?</legend>
    <label data-hand="length-short"><input type="radio" name="length" value="short"><span>Short · about 90 seconds</span></label>
    <label data-hand="length-full"><input type="radio" name="length" value="full"><span>Full song</span></label>
  </fieldset>
  <button class="primary" id="start" data-hand="start" data-hand-hold="${HAND_MENU.slowHoldSec}">Let’s dance →</button>
  <p class="keys">
    <span id="hand-hint">Point with an open hand ✋, then make a fist ✊ to choose · </span>Space or Enter to start · F fullscreen<br>
    <span id="stand-hint"></span>
    <span id="sound-hint" hidden><br>Click or press a key once, so the browser lets the music play.</span>
  </p>`;

/**
 * Two switches in a top corner of the menu. They are outside the scaled content, a little in
 * from the side: the camera tracks a hand badly at the edge of its picture.
 */
const MENU_SWITCHES_HTML = `
  <div class="corner">
    <button type="button" id="previews-switch" data-hand="previews"></button>
    <button type="button" id="hands-switch" data-hand="hand-control"></button>
  </div>`;

const STAND_HINT: Record<PlayerCount, string> = {
  1: 'Stand in the middle of the picture.',
  2: 'Stand side by side. Each dancer gets one half of the screen.',
};

function find<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

/** Ties a group of radio inputs to one value. */
function bindRadios(root: ParentNode, name: string, current: string, onPick: (value: string) => void): void {
  for (const input of root.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)) {
    input.checked = input.value === current;
    input.addEventListener('change', () => {
      if (input.checked) onPick(input.value);
    });
  }
}

/**
 * One song in the carousel: its cover picture. A song with no picture yet gets a plain cover
 * in its own colour, with its title on it.
 */
function songCard(index: number): string {
  const song = SONGS[index];
  // Steps of the golden angle give neighbours in the list clearly different colours.
  const hue = Math.round(index * 137.5) % 360;
  const cover = song.cover
    ? `<span class="cover"><img src="${song.cover}" alt=""></span>`
    : `<span class="cover plain"><span>${song.title}</span></span>`;
  return `
    <label class="song-card" style="--hue: ${hue}">
      <input type="radio" name="song" value="${index}" aria-label="${song.title}">${cover}
    </label>`;
}

/** One player's choices: level, hand shapes and faces. */
function playerCard(player: PlayerIndex, settings: Settings, onChange: () => void): HTMLElement {
  const side = player === 0 ? 'Left' : 'Right';
  const title = settings.playerCount === 1 ? 'Your level' : `Player ${player + 1} · ${side}`;
  const levelOptions = ALL_LEVELS.map(
    (level) => `
      <label data-hand="level-${player}-${level}">
        <input type="radio" name="level${player}" value="${level}">
        <span>Level ${level}<small>${LEVELS[level].name}</small></span>
      </label>`,
  ).join('');

  const card = document.createElement('fieldset');
  card.style.setProperty('--player', PLAYER_COLORS[player]);
  card.innerHTML = `
    <legend>${title}</legend>
    <div class="level-options">${levelOptions}</div>
    <div class="switches">
      <label class="shapes" data-hand="shapes-${player}"><input type="checkbox"><span>Hand shapes ✊ ✋ ☝️ ✌️</span></label>
      <label class="faces" data-hand="faces-${player}"><input type="checkbox"><span>Faces 😁 😲 😘</span></label>
    </div>`;

  const shapes = find<HTMLInputElement>(card, '.shapes input');
  /** A level with a shape on every cue has no use for the switch: it shows as on, and locked. */
  const showShapes = (): void => {
    const always = LEVELS[settings.levels[player]].shapeOnEveryCue;
    shapes.checked = always || settings.shapes[player];
    shapes.disabled = always;
  };
  showShapes();
  bindRadios(card, `level${player}`, String(settings.levels[player]), (value) => {
    settings.levels[player] = Number(value) as Level;
    showShapes();
    onChange();
  });
  shapes.addEventListener('change', () => {
    settings.shapes[player] = shapes.checked;
    onChange();
  });

  const faces = find<HTMLInputElement>(card, '.faces input');
  faces.checked = settings.faces[player];
  faces.addEventListener('change', () => {
    settings.faces[player] = faces.checked;
    onChange();
  });
  return card;
}

/** One player's result card. */
function resultCard(player: PlayerRun): HTMLElement {
  const { score } = player;
  const starCount = stars(score);
  const card = document.createElement('section');
  card.style.setProperty('--player', PLAYER_COLORS[player.index]);
  card.innerHTML = `
    <h2>Player ${player.index + 1} · Level ${player.level}</h2>
    <div class="stars" aria-label="${starCount} out of 5 stars">
      ${'★'.repeat(starCount)}<span>${'☆'.repeat(5 - starCount)}</span>
    </div>
    <strong class="result-score">${Math.round(score.score).toLocaleString()}</strong>
    <div class="result-stats">
      <span>${Math.round(accuracy(score) * 100)}%<small>Accuracy</small></span>
      <span>${score.maxCombo}<small>Best combo</small></span>
    </div>
    <div class="counts">
      <span>${score.perfect} Perfect</span>
      <span>${score.good} Good</span>
      <span>${score.miss} Miss</span>
    </div>
    <div class="replay-hold" data-player="${player.index}" role="progressbar"
      aria-label="Player ${player.index + 1} replay hold" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
      <span></span>
    </div>`;
  return card;
}

/** The page around the canvas: menu, results, messages and buttons. */
export class GameUI {
  readonly stage: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly debug: HTMLElement;
  readonly pauseButton: HTMLButtonElement;
  readonly resumeButton: HTMLButtonElement;
  /** Starts the reach fit again. It shows in the ready check, where a hand can choose it too. */
  readonly refitButton: HTMLButtonElement;
  private readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  /** Rings that show where the game sees pointing hands. They sit above the panel. */
  private readonly cursors: HTMLElement;
  private readonly message: HTMLElement;
  private readonly messageTitle: HTMLElement;
  private readonly messageDetail: HTMLElement;
  private readonly fitObserver = new ResizeObserver(() => this.fitPanel());
  /** Steps the open menu's carousel to the next or the previous song. Unset while the menu is closed. */
  private stepCarousel?: (direction: 1 | -1) => void;

  constructor(root: HTMLElement) {
    root.innerHTML = SHELL_HTML;
    this.root = root;
    this.stage = find(root, '#stage');
    this.canvas = find(root, 'canvas');
    this.panel = find(root, '#panel');
    this.cursors = find(root, '#cursors');
    this.message = find(root, '#message');
    this.messageTitle = find(this.message, 'h1');
    this.messageDetail = find(this.message, 'p');
    this.debug = find(root, '#debug');
    this.pauseButton = find(root, '#pause');
    this.resumeButton = find(root, '#resume');
    this.refitButton = find(root, '#refit');
  }

  /** Shows a large message over the game. With no title, hides it. */
  showMessage(title = '', detail = ''): void {
    // Only touch the page when the text changes: this runs on every frame of a countdown.
    if (this.messageTitle.textContent !== title) this.messageTitle.textContent = title;
    if (this.messageDetail.textContent !== detail) this.messageDetail.textContent = detail;
    this.message.hidden = !title;
  }

  hidePanel(): void {
    this.panel.hidden = true;
    this.stepCarousel = undefined;
  }

  /** In the menu: chooses the next song (1) or the previous one (-1). After the last comes the first. */
  stepSong(direction: 1 | -1): void {
    this.stepCarousel?.(direction);
  }

  /**
   * Shows the menu. It edits `settings` in place and calls `onChange` after each edit.
   * `onStart` hears whether a pointing hand pressed Start, and not a mouse or a key.
   */
  showMenu(settings: Settings, onStart: (byHand: boolean) => void, onChange: () => void): void {
    this.openPanel('menu', MENU_HTML, MENU_SWITCHES_HTML);

    // The two switches in the corner. Each shows its state in its text.
    const handHint = find(this.panel, '#hand-hint');
    const bindSwitch = (id: string, key: 'previews' | 'handControl', label: string, icons: [string, string]): void => {
      const button = find<HTMLButtonElement>(this.panel, id);
      const show = (): void => {
        const isOn = settings[key];
        button.textContent = `${isOn ? icons[0] : icons[1]} ${label} ${isOn ? 'on' : 'off'}`;
        button.setAttribute('aria-pressed', String(isOn));
        handHint.hidden = !settings.handControl;
      };
      show();
      button.addEventListener('click', () => {
        settings[key] = !settings[key];
        show();
        onChange();
      });
    };
    bindSwitch('#previews-switch', 'previews', 'Previews', ['🔊', '🔇']);
    bindSwitch('#hands-switch', 'handControl', 'Hand control', ['✋', '🚫']);

    // The songs are a carousel of covers: the chosen song in the middle, its neighbours beside
    // it, the rest out of sight. It takes the same room for six songs as for sixty.
    const strip = find(this.panel, '.song-strip');
    strip.innerHTML = SONGS.map((_, index) => songCard(index)).join('');
    const songCards = [...strip.querySelectorAll<HTMLElement>('.song-card')];
    const showSongs = (): void => {
      songCards.forEach((card, index) => {
        const offset = carouselOffset(index, settings.songIndex, SONGS.length);
        const onShow = Math.abs(offset) <= CAROUSEL_REACH;
        // Every card out of sight waits just past the last card on show, on its own side.
        card.dataset.offset = String(onShow ? offset : Math.sign(offset) * (CAROUSEL_REACH + 1));
        // Only a card on show can be pointed at.
        if (onShow) card.dataset.hand = `song-${index}`;
        else delete card.dataset.hand;
        find<HTMLInputElement>(card, 'input').checked = offset === 0;
      });
      find(this.panel, '#song-title').textContent = SONGS[settings.songIndex].title;
      find(this.panel, '#song-count').textContent = `${settings.songIndex + 1} of ${SONGS.length}`;
    };
    showSongs();
    const chooseSong = (index: number): void => {
      if (index === settings.songIndex) return;
      settings.songIndex = index;
      showSongs();
      onChange();
    };
    this.stepCarousel = (direction) => chooseSong(stepRing(settings.songIndex, direction, SONGS.length));
    songCards.forEach((card, index) => {
      find(card, 'input').addEventListener('change', () => chooseSong(index));
    });
    find(this.panel, '[data-hand="song-previous"]').addEventListener('click', () => this.stepSong(-1));
    find(this.panel, '[data-hand="song-next"]').addEventListener('click', () => this.stepSong(1));

    // A round started by hand has no click behind it, and a browser plays sound only on a page
    // that was clicked or typed in at least once. Ask for that one click while it is missing.
    const soundHint = find(this.panel, '#sound-hint');
    soundHint.hidden = navigator.userActivation?.hasBeenActive ?? true;
    const hideSoundHint = (): void => {
      soundHint.hidden = true;
    };
    window.addEventListener('pointerdown', hideSoundHint, { once: true });
    window.addEventListener('keydown', hideSoundHint, { once: true });

    const cards = find(this.panel, '.players');
    const standHint = find(this.panel, '#stand-hint');
    const showPlayers = (): void => {
      const indices: PlayerIndex[] = settings.playerCount === 1 ? [0] : [0, 1];
      cards.replaceChildren(...indices.map((player) => playerCard(player, settings, onChange)));
      cards.classList.toggle('solo', settings.playerCount === 1);
      standHint.textContent = STAND_HINT[settings.playerCount];
    };
    showPlayers();

    bindRadios(this.panel, 'count', String(settings.playerCount), (value) => {
      settings.playerCount = Number(value) as PlayerCount;
      showPlayers();
      onChange();
    });
    bindRadios(this.panel, 'length', settings.length, (value) => {
      settings.length = value as SongLength;
      onChange();
    });
    // A choice made by hand is a click made by the page, which the browser marks as not trusted.
    find(this.panel, '#start').addEventListener('click', (event) => onStart(!event.isTrusted));
  }

  /** `onRefit` hears whether a pointing hand chose it, and not a mouse. */
  showResults(
    players: readonly PlayerRun[],
    onReplay: () => void,
    onMenu: () => void,
    onRefit: (byHand: boolean) => void,
  ): void {
    const teamScore = players.reduce((sum, player) => sum + player.score.score, 0);
    const team =
      players.length > 1
        ? `<div class="team">Team score <strong>${Math.round(teamScore).toLocaleString()}</strong></div>`
        : '';
    this.openPanel(
      'results',
      `<div class="eyebrow">YOU MADE THE MUSIC MOVE</div>
      <h1>What a dance! 🎉</h1>
      <div class="result-players"></div>
      ${team}
      <p class="replay-prompt">Hands up to play again 🙌</p>
      <p>Raise a hand above your head and hold</p>
      <div class="result-actions">
        <button id="replay" class="primary" data-hand="replay" data-hand-hold="${HAND_MENU.slowHoldSec}">Play again · Space</button>
        <button id="menu" data-hand="menu" data-hand-hold="${HAND_MENU.slowHoldSec}">Menu · Esc</button>
        <button id="refit-results" data-hand="refit-results" data-hand-hold="${HAND_MENU.slowHoldSec}">↺ Recalibrate · C</button>
      </div>
      <div class="diagnostics" hidden>
        <button id="copy-diagnostics">Copy diagnostics</button>
        <span id="diagnostics-status" role="status"></span>
      </div>`,
    );
    find(this.panel, '.result-players').append(...players.map(resultCard));
    find(this.panel, '#replay').addEventListener('click', onReplay);
    find(this.panel, '#menu').addEventListener('click', onMenu);
    // A choice made by hand is a click made by the page, which the browser marks as not trusted.
    find(this.panel, '#refit-results').addEventListener('click', (event) => onRefit(!event.isTrusted));
  }

  // --- Choosing items by hand ---

  /**
   * The items a hand can choose now, with where they are on screen: those of the open panel,
   * and the recalibrate button while it shows.
   */
  handTargets(): HandTarget[] {
    const onPanel = this.panel.hidden ? [] : [...this.panel.querySelectorAll<HTMLElement>('[data-hand]')];
    const elements = this.refitButton.hidden ? onPanel : [...onPanel, this.refitButton];
    return elements.map((element) => {
      const { left, top, width, height } = element.getBoundingClientRect();
      return {
        id: element.dataset.hand ?? '',
        rect: { x: left, y: top, width, height },
        holdSec: Number(element.dataset.handHold ?? HAND_MENU.holdSec),
        repeats: element.dataset.handRepeat !== undefined,
      };
    });
  }

  /** Chooses an item as a click would. */
  chooseHandTarget(id: string): void {
    this.root.querySelector<HTMLElement>(`[data-hand="${id}"]`)?.click();
  }

  /**
   * Shows a ring at each hand (filled while the hand is a fist), a highlight on the item under
   * a hand, and inside that item a bar for how far the fist hold has come.
   * `hands` are screen positions. Call it with no hands to clear everything.
   */
  showHands(hands: readonly MenuHand[], hoveredId: string | null, progress: number): void {
    // Reuse the ring elements: this runs on every tracking frame.
    while (this.cursors.children.length < hands.length) {
      const ring = document.createElement('div');
      ring.className = 'hand-cursor';
      this.cursors.append(ring);
    }
    [...this.cursors.children].forEach((ring, i) => {
      const hand = hands[i];
      (ring as HTMLElement).hidden = hand === undefined;
      if (!hand) return;
      (ring as HTMLElement).style.transform = `translate(${hand.x}px, ${hand.y}px)`;
      ring.classList.toggle('fist', hand.fist);
    });

    for (const element of this.root.querySelectorAll<HTMLElement>('.hand-hover')) {
      if (element.dataset.hand !== hoveredId) element.classList.remove('hand-hover');
    }
    const hovered = hoveredId ? this.root.querySelector<HTMLElement>(`[data-hand="${hoveredId}"]`) : null;
    hovered?.classList.add('hand-hover');
    hovered?.style.setProperty('--hold', progress.toFixed(3));
  }

  /**
   * Shows the diagnostics row on the results panel: a status line and a button that copies
   * the run report as JSON. Does nothing when the results panel is no longer open.
   */
  showDiagnostics(json: string, status: string): void {
    const row = this.panel.querySelector<HTMLElement>('.diagnostics');
    if (!row) return;
    const statusLine = find(row, '#diagnostics-status');
    row.hidden = false;
    statusLine.textContent = status;
    find<HTMLButtonElement>(row, '#copy-diagnostics').onclick = () => {
      navigator.clipboard.writeText(json).then(
        () => (statusLine.textContent = 'Diagnostics copied.'),
        () => (statusLine.textContent = 'Copy failed. The report is also at window.__dance.report.'),
      );
    };
  }

  /** Fills each result card's bar while its player holds a hand up to replay. */
  updateHold(players: readonly PlayerRun[]): void {
    for (const player of players) {
      const bar = this.panel.querySelector<HTMLElement>(`.replay-hold[data-player="${player.index}"]`);
      if (!bar) continue;
      const percent = Math.round(player.hold * 100);
      bar.setAttribute('aria-valuenow', String(percent));
      find(bar, 'span').style.width = `${percent}%`;
    }
  }

  /** Opens the panel with `html` as its content. `outsideHtml` sits beside the content, in the panel's own corners. */
  private openPanel(className: string, html: string, outsideHtml = ''): void {
    this.stepCarousel = undefined;
    this.panel.className = className;
    this.panel.innerHTML = `<div class="fit">${html}</div>${outsideHtml}`;
    this.panel.hidden = false;
    this.message.hidden = true;

    // Fit again whenever the window or the content changes size.
    this.fitObserver.disconnect();
    this.fitObserver.observe(this.panel);
    this.fitObserver.observe(find(this.panel, '.fit'));
    this.fitPanel();
  }

  /**
   * Scales the panel's content down when the window is too small for it, so nothing scrolls.
   * In a large window the content keeps its design size and sits in the middle.
   */
  private fitPanel = (): void => {
    const content = this.panel.querySelector<HTMLElement>('.fit');
    if (!content || this.panel.hidden) return;
    const style = getComputedStyle(this.panel);
    const roomWidth = this.panel.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const roomHeight = this.panel.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    // offsetWidth and offsetHeight are the design size: a transform does not change them.
    const scale = Math.min(1, roomWidth / content.offsetWidth, roomHeight / content.offsetHeight);
    content.style.transform = scale < 1 ? `scale(${scale})` : '';
    // What sits outside the content shrinks with it (see `.corner` in the stylesheet).
    this.panel.style.setProperty('--fit', String(scale));
  };
}
