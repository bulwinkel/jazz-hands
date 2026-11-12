import { HAND_MENU, PLAYER_COLORS } from './config';
import { SHRINK_START_SCALE } from './cueStyle';
import type { CueStyle } from './cueStyle';
import { find } from './dom';
import type { HandTarget, MenuHand } from './handMenu';
import { buildMenu, MENU_HTML, MENU_SWITCHES_HTML } from './menuView';
import type { MenuControls } from './menuView';
import type { PlayerRun } from './player';
import { RECORDINGS_HTML, removePreview, showRecordings } from './recordingsView';
import type { RecordingsList } from './recordingsView';
import { playerHeading, RESULTS_HEADING } from './resultText';
import { accuracy, stars } from './scoring';
import type { Settings } from './settings';
import { VideoPlayer } from './videoPlayer';

/** A short note stays on screen this long. */
const TOAST_MS = 1600;

const SHELL_HTML = `
  <main id="stage" aria-label="Dance game">
    <canvas aria-label="Player grids, hand positions and beat cues"></canvas>
  </main>
  <div id="panel"></div>
  <div id="cursors" aria-hidden="true"></div>
  <div id="message" role="status" aria-live="polite"><h1></h1><p></p></div>
  <button id="resume" hidden>Click to start</button>
  <button id="pause" hidden aria-label="Pause game">Ⅱ Pause</button>
  <div id="rec" hidden aria-label="Recording">● REC</div>
  <div id="toast" hidden role="status"></div>
  <div id="player" hidden></div>
  <button id="refit" hidden data-hand="refit" data-hand-hold="${HAND_MENU.slowHoldSec}">↺ Recalibrate · C</button>
  <pre id="debug" hidden></pre>`;

/** One player's result card. */
function resultCard(player: PlayerRun): HTMLElement {
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

  constructor(root: HTMLElement) {
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
    this.resumeButton = find(root, '#resume');
    this.refitButton = find(root, '#refit');

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
    this.menu = undefined;
  }

  /**
   * Makes the page follow the cue style: the fist hold on a menu item shows its progress with
   * the same mark as a cue of a round (see the stylesheet), and the menu's switch names the style.
   */
  showCueStyle(style: CueStyle): void {
    document.body.dataset.cues = style;
    this.menu?.showCueStyle(style);
  }

  /** Shows a short note at the top of the screen, which goes away by itself. */
  showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toast.hidden = true), TOAST_MS);
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
   * Shows the recorded rounds on the open panel, newest first, with the preview of a round
   * above them. Does nothing on a panel with no place for them.
   */
  showRecordings(list: RecordingsList): void {
    const block = this.panel.querySelector<HTMLElement>('.recordings');
    if (block) showRecordings(block, list, (round, byHand) => this.player.open(round, byHand));
  }

  /** In the menu: chooses the next song (1) or the previous one (-1). After the last comes the first. */
  stepSong(direction: 1 | -1): void {
    this.menu?.stepSong(direction);
  }

  /**
   * Shows the menu. It edits `settings` in place and calls `onChange` after each edit.
   * `onStart` hears whether a pointing hand pressed Start, and not a mouse or a key.
   */
  showMenu(settings: Settings, onStart: (byHand: boolean) => void, onChange: () => void): void {
    this.openPanel('menu', MENU_HTML, MENU_SWITCHES_HTML);
    this.menu = buildMenu(this.panel, settings, { onStart, onChange });
    this.showCueStyle(settings.cueStyle);
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
      <h1>${RESULTS_HEADING}</h1>
      <div class="result-players"></div>
      ${team}
      <p class="replay-prompt">Hands up to play again 🙌</p>
      <p>Raise a hand above your head and hold</p>
      <div class="result-actions">
        <button id="replay" class="primary" data-hand="replay" data-hand-hold="${HAND_MENU.slowHoldSec}">Play again · Space</button>
        <button id="menu" data-hand="menu" data-hand-hold="${HAND_MENU.slowHoldSec}">Menu · Esc</button>
        <button id="refit-results" data-hand="refit-results" data-hand-hold="${HAND_MENU.slowHoldSec}">↺ Recalibrate · C</button>
      </div>
      ${RECORDINGS_HTML}
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

  /** The elements a hand can choose now. */
  private handElements(): HTMLElement[] {
    // The open video player covers everything else, so only its own buttons count.
    if (this.player.isOpen) return this.player.handElements();
    const onPanel = this.panel.hidden ? [] : [...this.panel.querySelectorAll<HTMLElement>('[data-hand]')];
    return this.refitButton.hidden ? onPanel : [...onPanel, this.refitButton];
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
    if (!hovered) return;
    hovered.classList.add('hand-hover');
    hovered.style.setProperty('--hold', progress.toFixed(3));
    // The shrink mark starts this far outside the item: as far as a cue's outline starts
    // outside its cell, measured on the item's height.
    hovered.style.setProperty('--outset', `${(hovered.offsetHeight * (SHRINK_START_SCALE - 1)) / 2}px`);
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
    this.menu = undefined;
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
