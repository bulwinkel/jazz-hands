import { LEVELS, PLAYER_COLORS, SONGS } from './config';
import type { PlayerRun } from './player';
import { accuracy, stars } from './scoring';
import type { Settings } from './settings';
import type { Level, PlayerCount, PlayerIndex, SongLength } from './types';

const ALL_LEVELS: Level[] = [1, 2, 3, 4];

const SHELL_HTML = `
  <main id="stage" aria-label="Dance game">
    <canvas aria-label="Player grids, hand positions and beat cues"></canvas>
  </main>
  <div id="panel"></div>
  <div id="message" role="status" aria-live="polite"><h1></h1><p></p></div>
  <button id="resume" hidden>Click to start</button>
  <button id="pause" hidden aria-label="Pause game">Ⅱ Pause</button>
  <pre id="debug" hidden></pre>`;

const MENU_HTML = `
  <div class="eyebrow">MOVE TOGETHER · PLAY TOGETHER</div>
  <h1>Kitchen Disco<span>✦</span></h1>
  <p class="subtitle">Reach for the beat. Make a little magic.</p>
  <div class="song">♫ <select aria-label="Song"></select></div>
  <fieldset class="count">
    <legend>Players</legend>
    <label><input type="radio" name="count" value="1"><span>1 player</span></label>
    <label><input type="radio" name="count" value="2"><span>2 players</span></label>
  </fieldset>
  <div class="players"></div>
  <fieldset class="length">
    <legend>How long shall we dance?</legend>
    <label><input type="radio" name="length" value="short">Short · about 90 seconds</label>
    <label><input type="radio" name="length" value="full">Full song</label>
  </fieldset>
  <button class="primary" id="start">Let’s dance →</button>
  <p class="keys">Space or Enter to start · F fullscreen<br><span id="stand-hint"></span></p>`;

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

/** Ties a checkbox to one player's entry in a pair of switches. */
function bindSwitch(
  root: ParentNode,
  selector: string,
  switches: [boolean, boolean],
  player: PlayerIndex,
  onChange: () => void,
): void {
  const input = find<HTMLInputElement>(root, selector);
  input.checked = switches[player];
  input.addEventListener('change', () => {
    switches[player] = input.checked;
    onChange();
  });
}

/** One player's choices: level, hand shapes and faces. */
function playerCard(player: PlayerIndex, settings: Settings, onChange: () => void): HTMLElement {
  const side = player === 0 ? 'Left' : 'Right';
  const title = settings.playerCount === 1 ? 'Your level' : `Player ${player + 1} · ${side}`;
  const levelOptions = ALL_LEVELS.map(
    (level) => `
      <label>
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
      <label class="shapes"><input type="checkbox"><span>Hand shapes ✊ ✋ ☝️ ✌️</span></label>
      <label class="faces"><input type="checkbox"><span>Faces 😀 😮 😗</span></label>
    </div>`;

  bindRadios(card, `level${player}`, String(settings.levels[player]), (value) => {
    settings.levels[player] = Number(value) as Level;
    onChange();
  });
  bindSwitch(card, '.shapes input', settings.shapes, player, onChange);
  bindSwitch(card, '.faces input', settings.faces, player, onChange);
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
  private readonly panel: HTMLElement;
  private readonly message: HTMLElement;
  private readonly messageTitle: HTMLElement;
  private readonly messageDetail: HTMLElement;

  constructor(root: HTMLElement) {
    root.innerHTML = SHELL_HTML;
    this.stage = find(root, '#stage');
    this.canvas = find(root, 'canvas');
    this.panel = find(root, '#panel');
    this.message = find(root, '#message');
    this.messageTitle = find(this.message, 'h1');
    this.messageDetail = find(this.message, 'p');
    this.debug = find(root, '#debug');
    this.pauseButton = find(root, '#pause');
    this.resumeButton = find(root, '#resume');
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
  }

  /** Shows the menu. It edits `settings` in place and calls `onChange` after each edit. */
  showMenu(settings: Settings, onStart: () => void, onChange: () => void): void {
    this.openPanel('menu', MENU_HTML);

    const songs = find<HTMLSelectElement>(this.panel, '.song select');
    SONGS.forEach((song, index) => songs.add(new Option(song.title, String(index))));
    songs.value = String(settings.songIndex);
    songs.addEventListener('change', () => {
      settings.songIndex = Number(songs.value);
      onChange();
    });

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
    find(this.panel, '#start').addEventListener('click', onStart);
  }

  showResults(players: readonly PlayerRun[], onReplay: () => void, onMenu: () => void): void {
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
        <button id="replay" class="primary">Play again · Space</button>
        <button id="menu">Menu · Esc</button>
      </div>
      <div class="diagnostics" hidden>
        <button id="copy-diagnostics">Copy diagnostics</button>
        <span id="diagnostics-status" role="status"></span>
      </div>`,
    );
    find(this.panel, '.result-players').append(...players.map(resultCard));
    find(this.panel, '#replay').addEventListener('click', onReplay);
    find(this.panel, '#menu').addEventListener('click', onMenu);
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

  private openPanel(className: string, html: string): void {
    this.panel.className = className;
    this.panel.innerHTML = html;
    this.panel.hidden = false;
    this.message.hidden = true;
  }
}
