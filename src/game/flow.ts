import type { TrackingFrame } from '../tracking/types';
import { SongAudio } from './audio';
import { generateChart } from './chart';
import { GAME_CONFIG as C, SONGS } from './config';
import { cellRect, defaultGrid, fitGrid, insideCell } from './geometry';
import { createInput } from './input';
import type { GameInput } from './input';
import { cueState, frameSongTime, judgeFrame } from './judgment';
import type { CueState } from './judgment';
import { playLength, validateManifest } from './manifest';
import { GameRenderer } from './render';
import type { Feedback } from './render';
import { award, freshScore } from './scoring';
import { parseSettings, STORAGE_KEY } from './settings';
import type { Options } from './settings';
import type { Cue, Manifest, Phase, Point, Rect, Score } from './types';
import { GameUI } from './ui';
interface PublicState { phase: Phase; songTime: number; players: (Score & { level: number })[] }
declare global { interface Window { __dance: PublicState } }
export class DanceGame {
  private ui: GameUI;
  private renderer: GameRenderer;
  private options: Options;
  private phase: Phase = 'menu';
  private audio?: SongAudio;
  private input?: GameInput;
  private manifest?: Manifest;
  private cues: [Cue[], Cue[]] = [[], []];
  private states: [CueState[], CueState[]] = [[], []];
  private grids: [Rect, Rect] = [defaultGrid(0), defaultGrid(1)];
  private samples: [Point[], Point[]] = [[], []];
  private scores: [Score, Score] = [freshScore(), freshScore()];
  private hold: [number, number] = [0, 0];
  private holdStart: [number | null, number | null] = [null, null];
  private frame?: TrackingFrame;
  private enteredAt = 0;
  private feedback: Feedback[] = [];
  private end = 0;
  private offset = 0;
  private paused = false;
  private switching = false;
  private generation = 0;
  private fps = 60;
  private lastRender = performance.now();
  private animation = 0;
  private debugEnabled = false;
  constructor(root: HTMLElement) {
    this.ui = new GameUI(root); this.renderer = new GameRenderer(this.ui.canvas);
    let stored: unknown;
    try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'); } catch { /* Storage may be blocked. */ }
    this.options = parseSettings(stored, location.search);
    this.ui.pauseButton.onclick = () => { void this.togglePause(); };
    this.ui.resumeButton.onclick = () => { void this.unlockAudio(); };
    window.addEventListener('keydown', this.key);
    window.addEventListener('pagehide', () => this.dispose(), { once: true });
    this.menu(); this.render();
    if (this.options.autostart) void this.start();
  }
  private save = (): void => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.options.settings)); } catch { /* Storage may be blocked. */ } };
  private enter(phase: Phase): void {
    this.phase = phase; this.enteredAt = performance.now(); this.holdStart = [null, null]; this.hold = [0, 0];
    this.ui.pauseButton.hidden = phase !== 'play';
    document.body.dataset.phase = phase; // Lets the stylesheet place messages per phase.
    this.expose();
  }
  private menu = (): void => {
    this.generation++; this.input?.dispose(); this.input = undefined; this.audio?.close(); this.audio = undefined;
    this.frame = undefined; this.paused = false; this.switching = false;
    this.ui.resumeButton.hidden = true; this.enter('menu'); this.ui.menu(this.options.settings, () => { void this.start(); }, this.save);
  };
  private async start(): Promise<void> {
    if (this.phase !== 'menu') return;
    this.save(); this.enter('loading'); this.ui.panel.hidden = true;
    this.ui.showMessage('Getting the dance floor ready…', 'Loading the song, camera, and local hand models');
    const generation = this.generation;
    const audio = new SongAudio(); this.audio = audio; audio.avOffsetMs = this.options.settings.avOffsetMs;
    // Call resume inside the Start gesture, before awaiting any network or model work.
    void audio.resume().catch(() => { /* The visible unlock button retries. */ });
    const input = createInput(this.options, this.ui.stage); this.input = input;
    try {
      const manifestTask = (async () => {
        const response = await fetch(SONGS[this.options.settings.songIndex].manifest);
        if (!response.ok) throw new Error(`Song manifest load failed (${response.status}).`);
        let json: unknown; try { json = await response.json(); } catch { throw new Error('Song manifest: invalid JSON.'); }
        const m = validateManifest(json); await audio.load(m.audio); return m;
      })();
      const results = await Promise.allSettled([manifestTask, input.init()]);
      if (generation !== this.generation) { input.dispose(); return; }
      if (results[0].status === 'rejected') throw results[0].reason;
      if (results[1].status === 'rejected') throw results[1].reason;
      this.manifest = results[0].value;
      this.end = playLength(this.manifest, this.options.settings.length);
      if (this.options.start >= this.end) throw new Error(`The start offset must be less than the play length (${this.end.toFixed(1)} seconds).`);
      this.offset = this.options.start;
      this.cues = this.options.settings.levels.map(level => level ? generateChart(this.manifest!, level, this.options.seed, this.end).filter(c => c.timeSec >= this.offset) : []) as [Cue[], Cue[]];
      if (input.video) this.ui.stage.prepend(input.video);
      input.start(() => ({ phase: this.phase, songTime: this.songTime(), grids: this.grids, cues: this.cues, levels: this.options.settings.levels }), this.trackingFrame, error => this.fail(error));
      if (audio.context.state === 'suspended') {
        this.ui.showMessage('Click to start', 'Your browser needs a click to turn on the music.'); this.ui.resumeButton.hidden = false;
      } else this.beginFit();
    } catch (error) { if (generation === this.generation) this.fail(error); }
  }
  private beginFit(): void {
    this.samples = [[], []]; this.grids = [defaultGrid(0), defaultGrid(1)]; this.enter('fit');
    this.ui.resumeButton.hidden = true;
  }
  /** Test inputs need no walk from the laptop to the play spot. */
  private walkBackSec(): number { return this.options.input === 'camera' ? C.walkBackSec : 0; }
  private async unlockAudio(): Promise<void> {
    try {
      await this.audio?.resume();
      if (this.audio?.context.state !== 'running') return;
      this.ui.resumeButton.hidden = true;
      if (this.phase === 'loading') this.beginFit();
      else if (this.phase === 'play') { this.paused = false; this.ui.showMessage(); }
    } catch (error) { this.fail(error); }
  }
  private songTime(): number { return this.phase === 'play' ? this.audio?.songTime ?? this.offset : this.phase === 'results' ? this.end : this.offset; }
  private trackingFrame = (frame: TrackingFrame): void => {
    const previous = this.frame; this.frame = frame;
    if (this.phase === 'fit') {
      // Ignore hands while the players walk from the laptop to their spots.
      if (performance.now() - this.enteredAt < this.walkBackSec() * 1000) return;
      ([0, 1] as const).forEach(i => { if (!this.options.settings.levels[i]) return; this.samples[i].push(...frame.players[i].hands.map(({ x, y }) => ({ x, y }))); this.grids[i] = fitGrid(this.samples[i], i); });
    } else if (this.phase === 'ready' || this.phase === 'results') {
      const duration = this.phase === 'ready' ? C.readyHoldSec : C.replayHoldSec;
      ([0, 1] as const).forEach(i => {
        if (!this.options.settings.levels[i]) { this.hold[i] = 1; return; }
        const hit = frame.players[i].hands.some(h => insideCell(h, cellRect(this.grids[i], 1)));
        if (!hit || (previous && frame.timeMs - previous.timeMs > 500)) this.holdStart[i] = null;
        if (hit && this.holdStart[i] === null) this.holdStart[i] = frame.timeMs;
        this.hold[i] = this.holdStart[i] === null ? 0 : Math.min(1, (frame.timeMs - this.holdStart[i]!) / (duration * 1000));
      });
      if (this.hold.every(h => h >= 1)) this.countdown();
    } else if (this.phase === 'play' && !this.paused && this.audio?.context.state === 'running') {
      this.judge(frameSongTime(this.songTime(), performance.now(), frame.timeMs, this.options.settings.inputLatencyMs), frame);
    }
  };
  private judge(time: number, frame?: TrackingFrame): void {
    ([0, 1] as const).forEach(i => {
      const level = this.options.settings.levels[i]; if (!level) return;
      for (const [index, state] of this.states[i].entries()) {
        if (state.cue.timeSec > time + C.windows[level].good[0] / -1000) break;
        const next = judgeFrame(state, level, this.grids[i], frame?.players[i].hands ?? [], time);
        this.states[i][index] = next;
        const result = state.result ? undefined : next.result;
        if (!result) continue;
        this.scores[i] = award(this.scores[i], result);
        this.feedback.push(...state.cue.cells.map(cell => ({ cell, result, at: performance.now(), player: i })));
      }
    });
  }
  private countdown = (): void => {
    if (!['ready', 'results', 'play'].includes(this.phase)) return;
    this.audio?.stop(); void this.audio?.resume().catch(error => this.fail(error));
    this.paused = false; this.feedback = []; this.scores = [freshScore(), freshScore()];
    this.states = [this.cues[0].map(cueState), this.cues[1].map(cueState)];
    this.ui.panel.hidden = true; this.enter('countdown');
  };
  private play(): void {
    try { this.audio!.play(this.offset, this.end, this.options.settings.length === 'short'); this.enter('play'); this.ui.pauseButton.textContent = 'Ⅱ Pause'; this.ui.showMessage(); }
    catch (error) { this.fail(error); }
  }
  private finish(): void {
    this.judge(this.end + 1); this.audio?.stop(); this.enter('results');
    this.ui.results(this.scores, this.options.settings, this.countdown, this.menu);
  }
  private fail(error: unknown): void {
    this.input?.dispose(); this.input = undefined; this.audio?.stop(); this.enter('error');
    this.ui.panel.hidden = true; this.ui.resumeButton.hidden = true;
    this.ui.showMessage('The dance floor needs a hand', `${error instanceof Error ? error.message : String(error)} Press Esc to return to the menu.`);
  }
  private async togglePause(): Promise<void> {
    if (this.phase !== 'play' || !this.audio || this.switching) return;
    try {
      if (this.paused) { await this.audio.resume(); this.paused = false; this.ui.showMessage(); }
      else { await this.audio.pause(); this.paused = true; this.ui.showMessage('Paused', 'Space to keep dancing · Esc for menu'); }
      this.ui.pauseButton.textContent = this.paused ? '▶ Resume' : 'Ⅱ Pause';
    } catch (error) { this.fail(error); }
  }
  private async cycleMode(): Promise<void> {
    if (!this.input || this.switching || this.phase === 'loading') return;
    this.switching = true; const input = this.input; const generation = this.generation;
    const modes = ['hands-full', 'hands-split', 'pose'] as const;
    const next = modes[(modes.indexOf(this.options.settings.tracker) + 1) % modes.length];
    const resume = this.phase === 'play' && !this.paused;
    try {
      if (resume) { await this.audio?.pause(); this.paused = true; }
      this.ui.showMessage('Changing hand tracker…'); await input.setMode(next);
      if (generation !== this.generation) { input.dispose(); return; }
      this.options.settings.tracker = next; this.save(); this.ui.showMessage();
      if (resume) { await this.audio?.resume(); this.paused = false; }
    } catch (error) { if (generation === this.generation) this.fail(error); }
    finally { this.switching = false; }
  }
  private key = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    const key = event.key.toLowerCase();
    if (key === 'escape') { event.preventDefault(); this.menu(); return; }
    if (key === 'f') { void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}); return; }
    if (key === 'd') this.debugEnabled = !this.debugEnabled;
    if (key === 'm') void this.cycleMode();
    if (key === '[' || key === ']') this.options.settings.inputLatencyMs += key === ']' ? 10 : -10;
    if (key === ',' || key === '.') this.options.settings.avOffsetMs += key === '.' ? 10 : -10;
    if ('[],.'.includes(key) && key.length === 1) { if (this.audio) this.audio.avOffsetMs = this.options.settings.avOffsetMs; this.save(); }
    if (key === 'r' && this.phase === 'play') this.countdown();
    if (key === ' ' || key === 'enter') {
      // Keep native arrow/Space controls available for the menu radio selectors.
      if (this.phase === 'menu' && ['INPUT', 'SELECT'].includes((event.target as HTMLElement).tagName)) return;
      if (key === 'enter' && this.phase !== 'menu') return;
      event.preventDefault();
      if (!this.ui.resumeButton.hidden) void this.unlockAudio();
      else if (this.phase === 'menu') void this.start();
      else if (this.phase === 'ready' || this.phase === 'results') this.countdown();
      else if (this.phase === 'play') void this.togglePause();
    }
  };
  private expose(): void { window.__dance = { phase: this.phase, songTime: this.songTime(), players: this.scores.map((score, i) => ({ ...score, level: this.options.settings.levels[i] })) }; }
  private render = (): void => {
    const now = performance.now(); this.fps = this.fps * 0.9 + 1000 / Math.max(1, now - this.lastRender) * 0.1; this.lastRender = now;
    const elapsed = (now - this.enteredAt) / 1000;
    if (this.phase === 'fit') {
      const lead = this.walkBackSec();
      if (elapsed < lead) this.ui.showMessage('Walk back to your spot!', `${Math.ceil(lead - elapsed)}`);
      else this.ui.showMessage('Draw the biggest circles you can with both arms!', `${Math.max(1, Math.ceil(lead + C.fitSec - elapsed))}`);
      if (elapsed >= lead + C.fitSec) { this.enter('ready'); this.ui.showMessage('Hands up to start!', 'Hold a hand in the glowing top-middle cell · Space also starts'); }
    } else if (this.phase === 'countdown') {
      this.ui.showMessage(String(Math.max(1, Math.ceil(C.countdownSec - elapsed))), 'Here comes the beat!');
      if (elapsed >= C.countdownSec) this.play();
    } else if (this.phase === 'play') {
      if (!this.paused && this.audio?.context.state === 'suspended') { this.paused = true; this.ui.resumeButton.hidden = false; this.ui.showMessage('Click to start', 'The audio clock is paused.'); }
      if (!this.paused) {
        const time = this.songTime();
        // Close windows even when the camera stops delivering frames. Never reuse stale hands.
        this.judge(time - this.options.settings.inputLatencyMs / 1000 - 0.001);
        if (time >= this.end) this.finish();
      }
    }
    if (this.phase === 'results') this.ui.updateHold(this.hold);
    this.feedback = this.feedback.filter(f => now - f.at < C.feedbackSec * 1000);
    this.renderer.draw({ phase: this.phase, grids: this.grids, levels: this.options.settings.levels, scores: this.scores, states: this.states, frame: this.frame, songTime: this.songTime(), manifest: this.manifest, end: this.end, hold: this.hold, feedback: this.feedback }, this.input?.video ? this.input.video.videoWidth / this.input.video.videoHeight : 16 / 9);
    this.ui.debug.hidden = !this.debugEnabled;
    if (this.debugEnabled) this.ui.debug.textContent = `FPS ${this.fps.toFixed(0)} · inference ${this.frame?.inferenceMs.toFixed(1) ?? '—'} ms\n${this.input?.mode ?? this.options.settings.tracker} · ${this.input?.delegate ?? '—'}\nHands ${this.frame?.players.map(p => p.hands.length).join(' / ') ?? '0 / 0'}\nInput ${this.options.settings.inputLatencyMs} ms · AV ${this.options.settings.avOffsetMs} ms\nSong ${this.songTime().toFixed(3)} s`;
    this.expose(); this.animation = requestAnimationFrame(this.render);
  };
  private dispose(): void { this.generation++; cancelAnimationFrame(this.animation); this.input?.dispose(); this.audio?.close(); window.removeEventListener('keydown', this.key); }
}
