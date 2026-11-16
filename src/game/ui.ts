import { GAME_YELLOW, VEIL } from './colors';
import { GROW_START_SCALE, HAND_MENU, PLAYER_COLORS, TOAST } from './config';
import { find, isHandClick } from './dom';
import type { HandTarget, MenuHand } from './handMenu';
import { buildMenu, MENU_HTML, MENU_SWITCHES_HTML } from './menuView';
import type { MenuControls } from './menuView';
import type { PlayerRun } from './player';
import type { ItemHover } from './playerPointers';
import { buildRatingRows, ratingRowHtml } from './ratingView';
import type { RateHandler, RatingRows } from './ratingView';
import { RECORDINGS_HTML, removePreview, showRecordings } from './recordingsView';
import type { RecordingsView } from './roundRecordings';
import { cueSetLine, movesLine, playerHeading, REPLAY_PROMPT, RESULTS_HEADING } from './resultText';
import { accuracy, stars } from './scoring';
import type { Settings } from './settings';
import { VideoPlayer } from './videoPlayer';


const SHELL_HTML = `
  <main id="stage" aria-label="Dance game">
    <canvas aria-label="Player grids, hand positions and beat cues"></canvas>
  </main>
  <div id="panel"></div>
  <div id="cursors" aria-hidden="true"></div>
  <div id="message" role="status" aria-live="polite"><h1></h1><p></p></div>
  <button id="resume" hidden>Click to start</button>
  <div id="round-buttons">
    <button id="to-menu" hidden aria-label="Back to the menu">✕ Menu</button>
    <button id="restart" hidden aria-label="Start the round again">↺ Restart</button>
    <button id="pause" hidden aria-label="Pause game">Ⅱ Pause</button>
  </div>
  <div id="rec" hidden aria-label="Recording">● REC</div>
  <div id="toast" hidden role="status"></div>
  <div id="player" hidden></div>
  <button id="fullscreen" hidden>⛶ Full screen</button>
  <pre id="debug" hidden></pre>`;

/**
 * One player's result card. The line of the chart's moves is there for every player, empty
 * for a chart with no moves, so the cards of two players line up and no round moves them.
 * `rated` adds the row of stars that rates the cue set, under the moves.
 */
function resultCard(player: PlayerRun, rated: boolean): HTMLElement {
  const { score } = player;
  const starCount = stars(score);
  const card = document.createElement('section');
  card.style.setProperty('--player', PLAYER_COLORS[player.index]);
  card.innerHTML = `
    <h2>${playerHeading(player)}</h2>
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
    <p class="result-moves">${movesLine(player.moves) ?? ''}</p>
    ${rated ? ratingRowHtml(player.index) : ''}
    <div class="replay-hold" data-player="${player.index}" role="progressbar"
      aria-label="Player ${player.index + 1} replay hold" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
      <span></span>
    </div>`;
  return card;
}

/**
 * The round's cue set on the results, in the top corner where the menu has its set switch.
 * There it takes no room from the score and the buttons. Nothing for a round with no set.
 */
function setCorner(cueSet: number | null): string {
  const line = cueSetLine(cueSet);
  return line === null ? '' : `<div class="corner"><p class="result-set">${line}</p></div>`;
}

/** What the buttons and the stars of the results call. */
export interface ResultHandlers {
  onReplay: () => void;
  onMenu: () => void;
  /** Hears whether a pointing hand chose it, and not a mouse. */
  onRefit: (byHand: boolean) => void;
  /** Saves a player's rating of the cue set. Without it, the cards have no rating row. */
  onRate?: RateHandler;
}

/** The page around the canvas: menu, results, messages and buttons. */
export class GameUI {
  readonly stage: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly debug: HTMLElement;
  readonly pauseButton: HTMLButtonElement;
  /** Starts the round again, as the R key does. It shows beside the pause button, in a round. */
  readonly restartButton: HTMLButtonElement;
  /** Goes back to the menu, as the Esc key does. It shows from the start of a round to its end. */
  readonly menuButton: HTMLButtonElement;
  readonly resumeButton: HTMLButtonElement;
  /** Makes the page full screen. A touch presses it: a tablet has no F key. */
  readonly fullscreenButton: HTMLButtonElement;
  /** Plays a recorded round. It lies over the panel and under the hand rings. */
  readonly player: VideoPlayer;
  private readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  /** Rings that show where the game sees pointing hands. They sit above the panel. */
  private readonly cursors: HTMLElement;
  private readonly messageBox: HTMLElement;
  private readonly recordingMark: HTMLElement;
  private readonly toast: HTMLElement;
  private toastTimer = 0;
  private readonly messageTitle: HTMLElement;
  private readonly messageDetail: HTMLElement;
  private readonly fitObserver = new ResizeObserver(() => this.fitPanel());
  /** The open menu. Unset while the menu is closed. */
  private menu?: MenuControls;
  /** The rating rows of the open results. Unset while the results have none. */
  private ratings?: RatingRows;
  /** Goes up each time the panel opens or closes. See `handScreen`. */
  private panelOpenings = 0;

  constructor(root: HTMLElement) {
    // The stylesheet takes these values from the game's code, so one change reaches the page
    // and the canvas: the menu's hold mark must grow as a cue's block does, and the game view
    // copies the veil. The game's yellow stays with the other colours, in colors.ts.
    const page = root.ownerDocument.documentElement.style;
    page.setProperty('--game-yellow', GAME_YELLOW);
    page.setProperty('--grow-start', String(GROW_START_SCALE));
    page.setProperty('--veil', VEIL);

    root.innerHTML = SHELL_HTML;
    this.root = root;
    this.stage = find(root, '#stage');
    this.canvas = find(root, 'canvas');
    this.panel = find(root, '#panel');
    this.cursors = find(root, '#cursors');
    this.messageBox = find(root, '#message');
    this.recordingMark = find(root, '#rec');
    this.toast = find(root, '#toast');
    this.messageTitle = find(this.messageBox, 'h1');
    this.messageDetail = find(this.messageBox, 'p');
    this.debug = find(root, '#debug');
    this.pauseButton = find(root, '#pause');
    this.restartButton = find(root, '#restart');
    this.menuButton = find(root, '#to-menu');
    this.resumeButton = find(root, '#resume');
    this.fullscreenButton = find(root, '#fullscreen');

    this.player = new VideoPlayer(find(root, '#player'));
  }

  /** Shows a large message over the game. With no title, hides it. */
  showMessage(title = '', detail = ''): void {
    // Only touch the page when the text changes: this runs on every frame of a countdown.
    if (this.messageTitle.textContent !== title) this.messageTitle.textContent = title;
    if (this.messageDetail.textContent !== detail) this.messageDetail.textContent = detail;
    this.messageBox.hidden = !title;
  }

  hidePanel(): void {
    removePreview(this.panel);
    this.panel.hidden = true;
    this.panelOpenings++;
    this.closeMenu();
  }

  /** Shows a short note at the top of the screen, which goes away by itself after `durationMs`. */
  showToast(text: string, durationMs: number = TOAST.shortMs): void {
    this.toast.textContent = text;
    this.toast.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toast.hidden = true), durationMs);
  }

  /** The large message on screen now, or undefined when none shows. */
  get message(): { title: string; detail: string } | undefined {
    if (this.messageBox.hidden) return undefined;
    return { title: this.messageTitle.textContent ?? '', detail: this.messageDetail.textContent ?? '' };
  }

  /** Shows the red mark that tells the players a round is recorded. */
  showRecordingMark(isOn: boolean): void {
    this.recordingMark.hidden = !isOn;
  }

  /**
   * Shows the recording of the round on the results: the placeholder while its videos are
   * made, then its preview and download links. Does nothing on a panel with no place for it.
   */
  showRecordings(view: RecordingsView): void {
    const block = this.panel.querySelector<HTMLElement>('.recordings');
    if (block) showRecordings(block, view, (round, byHand) => this.player.open(round, byHand));
  }

  /** In the menu: chooses the next song (1) or the previous one (-1). After the last comes the first. */
  stepSong(direction: 1 | -1): void {
    this.menu?.stepSong(direction);
  }

  /** Shows the menu. It edits `settings` in place and calls `onChange` after each edit. */
  showMenu(settings: Settings, onStart: () => void, onChange: () => void): void {
    this.openPanel('menu', MENU_HTML, MENU_SWITCHES_HTML);
    this.menu = buildMenu(this.panel, settings, { onStart, onChange });
  }

  /** `cueSet` is the set that the round played, or null for a round with no set. */
  showResults(players: readonly PlayerRun[], cueSet: number | null, handlers: ResultHandlers): void {
    const { onReplay, onMenu, onRefit, onRate } = handlers;
    const teamScore = players.reduce((sum, player) => sum + player.score.score, 0);
    const team =
      players.length > 1
        ? `<div class="team">Team score <strong>${Math.round(teamScore).toLocaleString()}</strong></div>`
        : '';
    this.openPanel(
      'results',
      `<div class="eyebrow">YOU MADE THE MUSIC MOVE</div>
      <h1>${RESULTS_HEADING}</h1>
      <div class="result-players"></div>
      <div class="results-lower">
        <div class="results-next">
          ${team}
          <p class="replay-prompt">${REPLAY_PROMPT}</p>
          <div class="result-actions">
            <button id="replay" class="primary" data-hand="replay" data-hand-hold="${HAND_MENU.slowHoldSec}">Play again · Space</button>
            <button id="menu" data-hand="menu" data-hand-hold="${HAND_MENU.slowHoldSec}">Menu · Esc</button>
            <button id="refit-results" data-hand="refit-results" data-hand-hold="${HAND_MENU.slowHoldSec}">↺ Recalibrate · C</button>
          </div>
        </div>
        ${RECORDINGS_HTML}
      </div>
      <div class="diagnostics" hidden>
        <button id="copy-diagnostics">Copy diagnostics</button>
        <span id="diagnostics-status" role="status"></span>
      </div>`,
      setCorner(cueSet),
    );
    const cards = players.map((player) => resultCard(player, onRate !== undefined));
    find(this.panel, '.result-players').append(...cards);
    if (onRate) this.ratings = buildRatingRows(this.panel, onRate);
    find(this.panel, '#replay').addEventListener('click', onReplay);
    find(this.panel, '#menu').addEventListener('click', onMenu);
    find(this.panel, '#refit-results').addEventListener('click', (event) => onRefit(isHandClick(event)));
  }

  // --- Choosing items by hand ---

  /** The items a hand can choose now, with where they are on screen: those of the open panel. */
  handTargets(): HandTarget[] {
    return this.handElements().map((element) => {
      const { left, top, width, height } = element.getBoundingClientRect();
      return {
        id: element.dataset.hand ?? '',
        rect: { x: left, y: top, width, height },
        holdSec: Number(element.dataset.handHold ?? HAND_MENU.holdSec),
        repeats: element.dataset.handRepeat !== undefined,
      };
    });
  }

  /**
   * Names the screen that the hands point at: which panel is open, and whether the video
   * player covers it. A new panel, a closed one, or the player opening or closing changes it.
   * A change inside the panel, such as the song carousel moving on, does not.
   */
  get handScreen(): string {
    return `${this.panelOpenings} ${this.player.isOpen}`;
  }

  /** The elements a hand can choose now. */
  private handElements(): HTMLElement[] {
    // The open video player covers everything else, so only its own buttons count.
    if (this.player.isOpen) return this.player.handElements();
    return this.panel.hidden ? [] : [...this.panel.querySelectorAll<HTMLElement>('[data-hand]')];
  }

  /** Chooses an item as a click would. The click is not trusted, so a handler can tell it from a real one. */
  chooseHandTarget(id: string): void {
    this.root.querySelector<HTMLElement>(`[data-hand="${id}"]`)?.click();
  }

  /**
   * Shows a ring at each hand (filled while the hand is a fist), a highlight on each item that
   * a player's pointer is on, and on that item a cue's timing mark for how far the fist hold
   * has come. `hands` are screen positions. Call it with no hands and no hovers to clear everything.
   */
  showHands(hands: readonly MenuHand[], hovers: readonly ItemHover[]): void {
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

    const hoveredIds = hovers.map((hover) => hover.id);
    for (const element of this.root.querySelectorAll<HTMLElement>('.hand-hover')) {
      if (!hoveredIds.includes(element.dataset.hand ?? '')) element.classList.remove('hand-hover');
    }
    this.ratings?.showHandsOn(hovers);
    for (const hover of hovers) {
      const hovered = this.root.querySelector<HTMLElement>(`[data-hand="${hover.id}"]`);
      if (!hovered) continue;
      hovered.classList.add('hand-hover');
      hovered.style.setProperty('--hold', hover.progress.toFixed(3));
    }
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
    removePreview(this.panel);
    this.closeMenu();
    this.ratings = undefined;
    this.panelOpenings++;
    this.panel.className = className;
    this.panel.innerHTML = `<div class="fit">${html}</div>${outsideHtml}`;
    this.panel.hidden = false;
    this.messageBox.hidden = true;

    // Fit again whenever the window or the content changes size.
    this.fitObserver.disconnect();
    this.fitObserver.observe(this.panel);
    this.fitObserver.observe(find(this.panel, '.fit'));
    this.fitPanel();
  }

  /** The menu leaves the panel: its listeners outside the panel end. */
  private closeMenu(): void {
    this.menu?.close();
    this.menu = undefined;
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
