import { PLAYER_COLORS, SONGS } from './config';
import { accuracy, stars } from './scoring';
import type { Settings } from './settings';
import type { PlayerLevel, Score } from './types';
export class GameUI {
  readonly stage: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly panel: HTMLElement;
  readonly message: HTMLElement;
  readonly debug: HTMLElement;
  readonly pauseButton: HTMLButtonElement;
  readonly resumeButton: HTMLButtonElement;
  private title: HTMLElement;
  private detail: HTMLElement;
  constructor(root: HTMLElement) {
    root.innerHTML = `<main id="stage" aria-label="Dance game"><canvas aria-label="Player grids, hand positions, and beat cues"></canvas></main>
      <div id="panel"></div><div id="message" role="status" aria-live="polite"><h1></h1><p></p></div>
      <button id="resume" hidden>Click to start</button><button id="pause" hidden aria-label="Pause game">Ⅱ Pause</button><pre id="debug" hidden></pre>`;
    this.stage = root.querySelector('#stage')!; this.canvas = root.querySelector('canvas')!;
    this.panel = root.querySelector('#panel')!; this.message = root.querySelector('#message')!;
    this.title = this.message.querySelector('h1')!; this.detail = this.message.querySelector('p')!;
    this.debug = root.querySelector('#debug')!; this.pauseButton = root.querySelector('#pause')!; this.resumeButton = root.querySelector('#resume')!;
  }
  showMessage(title = '', detail = ''): void {
    if (this.title.textContent !== title) this.title.textContent = title;
    if (this.detail.textContent !== detail) this.detail.textContent = detail;
    this.message.hidden = !title;
  }
  menu(settings: Settings, start: () => void, save: () => void): void {
    this.panel.hidden = false; this.panel.className = 'menu'; this.message.hidden = true;
    this.panel.innerHTML = `<div class="eyebrow">MOVE TOGETHER · PLAY TOGETHER</div><h1>Kitchen Disco<span>✦</span></h1>
      <p class="subtitle">Reach for the beat. Make a little magic.</p><div class="song">♫ <select aria-label="Song"></select></div><div class="players"></div>
      <fieldset class="length"><legend>How long shall we dance?</legend><label><input type="radio" name="length" value="short">Short · about 90 seconds</label>
      <label><input type="radio" name="length" value="full">Full song</label></fieldset><button class="primary" id="start">Let’s dance →</button>
      <p class="keys">Space / Enter to start · F fullscreen<br>Stand side by side. Each dancer gets one half of the screen.</p>`;
    const songs = this.panel.querySelector<HTMLSelectElement>('.song select')!;
    SONGS.forEach((song, i) => { const option = document.createElement('option'); option.value = String(i); option.textContent = song.title; songs.append(option); });
    songs.value = String(settings.songIndex);
    songs.onchange = () => { settings.songIndex = Number(songs.value); save(); };
    for (const i of [0, 1] as const) {
      const field = document.createElement('fieldset'); field.style.setProperty('--player', PLAYER_COLORS[i]);
      field.innerHTML = `<legend>Player ${i + 1} · ${i === 0 ? 'Left' : 'Right'}</legend><div class="level-options">${['Off', 'Level 1<small>Slow</small>', 'Level 2<small>Every beat</small>', 'Level 3<small>Hand shapes</small>'].map((label, n) => `<label><input type="radio" name="p${i}" value="${n}" ${settings.levels[i] === n ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div>`;
      field.addEventListener('change', e => {
        const input = e.target as HTMLInputElement; const n = Number(input.value) as PlayerLevel;
        if (n === 0 && settings.levels[1 - i] === 0) { input.checked = false; field.querySelector<HTMLInputElement>(`input[value="${settings.levels[i]}"]`)!.checked = true; return; }
        settings.levels[i] = n; save();
      });
      this.panel.querySelector('.players')!.append(field);
    }
    this.panel.querySelector<HTMLInputElement>(`input[name="length"][value="${settings.length}"]`)!.checked = true;
    this.panel.querySelector('.length')!.addEventListener('change', e => { settings.length = (e.target as HTMLInputElement).value as Settings['length']; save(); });
    this.panel.querySelector('#start')!.addEventListener('click', start);
  }
  updateHold(values: [number, number]): void {
    this.panel.querySelectorAll<HTMLElement>('.replay-hold').forEach(bar => {
      const value = Math.round(values[Number(bar.dataset.player)] * 100);
      bar.setAttribute('aria-valuenow', String(value));
      bar.querySelector<HTMLElement>('span')!.style.width = `${value}%`;
    });
  }
  results(scores: [Score, Score], settings: Settings, replay: () => void, menu: () => void): void {
    this.panel.hidden = false; this.panel.className = 'results'; this.message.hidden = true;
    this.panel.innerHTML = `<div class="eyebrow">YOU MADE THE MUSIC MOVE</div><h1>What a dance! 🎉</h1><div class="result-players"></div>
      <div class="team">Team score <strong>${Math.round(scores[0].score + scores[1].score).toLocaleString()}</strong></div>
      <p class="replay-prompt">Hands up to play again 🙌</p><p>Raise a hand above your head and hold</p>
      <div class="result-actions"><button id="replay" class="primary">Play again · Space</button><button id="menu">Menu · Esc</button></div>`;
    ([0, 1] as const).filter(i => settings.levels[i]).forEach(i => {
      const s = scores[i]; const card = document.createElement('section'); card.style.setProperty('--player', PLAYER_COLORS[i]);
      const count = stars(s);
      card.innerHTML = `<h2>Player ${i + 1} · Level ${settings.levels[i]}</h2><div class="stars" aria-label="${count} out of 5 stars">${'★'.repeat(count)}<span>${'☆'.repeat(5 - count)}</span></div>
        <strong class="result-score">${Math.round(s.score).toLocaleString()}</strong><div class="result-stats"><span>${Math.round(accuracy(s) * 100)}%<small>Accuracy</small></span><span>${s.maxCombo}<small>Best combo</small></span></div>
        <div class="counts"><span>${s.perfect} Perfect</span><span>${s.good} Good</span><span>${s.miss} Miss</span></div><div class="replay-hold" data-player="${i}" role="progressbar" aria-label="Player ${i + 1} replay hold" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div>`;
      this.panel.querySelector('.result-players')!.append(card);
    });
    this.panel.querySelector('#replay')!.addEventListener('click', replay); this.panel.querySelector('#menu')!.addEventListener('click', menu);
  }
}
