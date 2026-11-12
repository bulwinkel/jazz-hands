import type { FaceExpression, FaceRegions, TrackedFace, TrackerMode, TrackingFrame } from '../tracking/types';
import { SongAudio } from './audio';
import { generateChart } from './chart';
import { DEFAULT_TRACKER, FACE_EMOJI, HANDS_UP_CELL, LEVELS, SONGS, TIMING } from './config';
import { generateFaceCues } from './faceChart';
import { judgeFaceFrame, newFaceCueState, openFaceCue } from './faceJudgment';
import { cellRect, defaultGrid, faceRegion, fitGrid, insideCell } from './geometry';
import { createInput } from './input';
import type { GameInput, InputView } from './input';
import { frameSongTime, judgeFrame, newCueState } from './judgment';
import type { CueState } from './judgment';
import { playLengthSec, validateManifest } from './manifest';
import { createPlayers, summariseChart } from './player';
import type { ChartSummary, PlayerRun } from './player';
import { GameRenderer } from './render';
import type { Feedback } from './render';
import { award, freshScore } from './scoring';
import { parseSettings, STORAGE_KEY } from './settings';
import type { Options } from './settings';
import { mergeForSolo } from './solo';
import type { Manifest, Phase, PlayerIndex, Rating, Score } from './types';
import { GameUI } from './ui';

/** Live state for automated checks, at `window.__dance`. Always two player entries. */
interface PublicPlayer extends Score {
  /** 0 for a player who is not in this session. */
  level: number;
  chart: ChartSummary;
}
interface PublicState {
  phase: Phase;
  songTime: number;
  players: PublicPlayer[];
}
declare global {
  interface Window {
    __dance: PublicState;
  }
}

const TRACKER_CYCLE: readonly TrackerMode[] = ['hands-full', 'hands-split', 'pose'];
const PLAYER_SLOTS: readonly PlayerIndex[] = [0, 1];

function readStoredSettings(): unknown {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    return null; // Storage can be blocked or hold bad data. The defaults apply.
  }
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Runs the game through its phases:
 * menu → loading → fit (walk back, then reach fit) → ready → countdown → play → results.
 * Results loop back to countdown on replay. Esc returns to the menu from anywhere.
 */
export class DanceGame {
  private readonly ui: GameUI;
  private readonly renderer: GameRenderer;
  private readonly options: Options;

  private phase: Phase = 'menu';
  private phaseStartedMs = 0;
  /** Goes up each time a session is abandoned, so work that finishes late can tell it is stale. */
  private session = 0;

  private audio?: SongAudio;
  private input?: GameInput;
  private manifest?: Manifest;
  private players: PlayerRun[] = [];
  /** The latest tracking frame, after the one-player merge. */
  private frame?: TrackingFrame;
  private feedback: Feedback[] = [];
  private startSec = 0;
  private endSec = 0;
  private paused = false;

  /** Tracker picked with the M key. It lasts until the page reloads. */
  private pickedTracker?: TrackerMode;
  private switchingTracker = false;

  private debugVisible = false;
  private fps = 60;
  private lastRenderMs = performance.now();
  private animationId = 0;

  constructor(root: HTMLElement) {
    this.ui = new GameUI(root);
    this.renderer = new GameRenderer(this.ui.canvas);
    this.options = parseSettings(readStoredSettings(), location.search);

    this.ui.pauseButton.addEventListener('click', () => void this.togglePause());
    this.ui.resumeButton.addEventListener('click', () => void this.unlockAudio());
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('pagehide', () => this.dispose(), { once: true });

    this.showMenu();
    this.render();
    if (this.options.autostart) void this.start();
  }

  // --- Phases ---

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.phaseStartedMs = performance.now();
    for (const player of this.players) {
      player.holdStartMs = null;
      player.hold = 0;
    }
    this.ui.pauseButton.hidden = phase !== 'play';
    document.body.dataset.phase = phase; // The stylesheet places messages by phase.
    this.expose();
  }

  private showMenu = (): void => {
    this.session++;
    this.input?.dispose();
    this.input = undefined;
    this.audio?.close();
    this.audio = undefined;
    this.players = [];
    this.frame = undefined;
    this.paused = false;
    this.switchingTracker = false;
    this.ui.resumeButton.hidden = true;
    this.setPhase('menu');
    this.ui.showMenu(this.options.settings, () => void this.start(), this.saveSettings);
  };

  /** Loads the song, the camera and the hand models, then begins the reach fit. */
  private async start(): Promise<void> {
    if (this.phase !== 'menu') return;
    this.saveSettings();
    this.setPhase('loading');
    this.ui.hidePanel();
    this.ui.showMessage('Getting the dance floor ready…', 'Loading the song, camera and hand models');

    const session = this.session;
    const { settings } = this.options;
    const audio = new SongAudio();
    audio.avOffsetMs = settings.avOffsetMs;
    this.audio = audio;
    // Browsers allow sound only after a click or key press. Resume now, inside the Start
    // gesture, before the first await. If it fails, the "Click to start" button retries.
    void audio.resume().catch(() => {});

    const input = createInput(this.options, this.trackerMode(), this.ui.stage);
    this.input = input;

    try {
      const [song, inputReady] = await Promise.allSettled([this.loadSong(audio), input.init()]);
      if (session !== this.session) {
        input.dispose(); // The player left for the menu while this loaded.
        return;
      }
      if (song.status === 'rejected') throw song.reason;
      if (inputReady.status === 'rejected') throw inputReady.reason;

      const manifest = song.value;
      this.manifest = manifest;
      this.endSec = playLengthSec(manifest, settings.length);
      this.startSec = this.options.startSec;
      if (this.startSec >= this.endSec) {
        throw new Error(`The start offset must be below the play length (${this.endSec.toFixed(1)} seconds).`);
      }

      this.players = createPlayers(settings);
      for (const player of this.players) {
        const chart = generateChart(manifest, {
          level: player.level,
          shapes: player.shapes,
          seed: this.options.seed,
          endSec: this.endSec,
        });
        player.cues = chart.filter((cue) => cue.timeSec >= this.startSec);
        if (player.faces) {
          const faceCues = generateFaceCues(manifest, this.options.seed, this.endSec);
          player.faceCues = faceCues.filter((cue) => cue.timeSec >= this.startSec);
        }
      }

      if (input.video) this.ui.stage.prepend(input.video);
      input.start(this.inputView, this.onTrackingFrame, (error) => this.fail(error));

      if (audio.context.state === 'suspended') {
        this.askForClick('Your browser needs a click to turn on the music.');
      } else {
        this.beginFit();
      }
    } catch (error) {
      if (session === this.session) this.fail(error);
    }
  }

  private async loadSong(audio: SongAudio): Promise<Manifest> {
    const response = await fetch(SONGS[this.options.settings.songIndex].manifest);
    if (!response.ok) throw new Error(`Song manifest load failed (${response.status}).`);
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new Error('Song manifest: invalid JSON.');
    }
    const manifest = validateManifest(json);
    await audio.load(manifest.audio);
    return manifest;
  }

  private beginFit(): void {
    const { playerCount } = this.options.settings;
    for (const player of this.players) {
      player.reachSamples = [];
      player.grid = defaultGrid(player.index, playerCount);
    }
    this.ui.resumeButton.hidden = true;
    this.setPhase('fit');
  }

  /** Starts, or restarts, the song from its 3-2-1 countdown. Keeps the fitted grids. */
  private beginCountdown = (): void => {
    if (this.phase !== 'ready' && this.phase !== 'results' && this.phase !== 'play') return;
    this.audio?.stop();
    void this.audio?.resume().catch((error: unknown) => this.fail(error));
    this.paused = false;
    this.feedback = [];
    for (const player of this.players) {
      player.score = freshScore();
      player.states = player.cues.map(newCueState);
      player.faceStates = player.faceCues.map(newFaceCueState);
    }
    this.ui.hidePanel();
    this.setPhase('countdown');
  };

  private beginPlay(): void {
    try {
      this.audio?.play(this.startSec, this.endSec, this.options.settings.length === 'short');
    } catch (error) {
      this.fail(error);
      return;
    }
    this.setPhase('play');
    this.ui.pauseButton.textContent = 'Ⅱ Pause';
    this.ui.showMessage();
  }

  private finish(): void {
    this.judge(this.endSec + 1); // Closes every cue that is still open.
    this.audio?.stop();
    this.setPhase('results');
    this.ui.showResults(this.players, this.beginCountdown, this.showMenu);
  }

  private fail(error: unknown): void {
    this.input?.dispose();
    this.input = undefined;
    this.audio?.stop();
    this.setPhase('error');
    this.ui.hidePanel();
    this.ui.resumeButton.hidden = true;
    this.ui.showMessage('The dance floor needs a hand', `${errorText(error)} Press Esc to return to the menu.`);
  }

  // --- Tracking frames ---

  private onTrackingFrame = (raw: TrackingFrame): void => {
    const frame = this.options.settings.playerCount === 1 ? mergeForSolo(raw) : raw;
    const previous = this.frame;
    this.frame = frame;
    this.rememberFaces(frame);

    if (this.phase === 'fit') {
      this.collectReach(frame);
    } else if (this.phase === 'ready' || this.phase === 'results') {
      this.trackHandsUp(frame, previous);
    } else if (this.phase === 'play' && !this.paused && this.audio?.context.state === 'running') {
      const { inputLatencyMs } = this.options.settings;
      this.judge(frameSongTime(this.songTime(), performance.now(), frame.timeMs, inputLatencyMs), frame);
    }
  };

  /** Keeps where each face was last found. A face cue is drawn there, on the player's own face. */
  private rememberFaces(frame: TrackingFrame): void {
    for (const player of this.players) {
      const face = frame.players[player.index].face;
      if (face) player.faceSeenAt = { x: face.x, y: face.y };
    }
  }

  /** Reach fit: grows each player's grid around the hand positions seen so far. */
  private collectReach(frame: TrackingFrame): void {
    // Ignore hands while the players walk from the laptop to their spots.
    if (performance.now() - this.phaseStartedMs < this.walkBackSec() * 1000) return;
    for (const player of this.players) {
      for (const hand of frame.players[player.index].hands) {
        player.reachSamples.push({ x: hand.x, y: hand.y });
      }
      player.grid = fitGrid(player.reachSamples, player.index, this.options.settings.playerCount);
    }
  }

  /** Ready and replay: every player holds a hand in the hands-up cell without a break. */
  private trackHandsUp(frame: TrackingFrame, previous: TrackingFrame | undefined): void {
    const holdSec = this.phase === 'ready' ? TIMING.readyHoldSec : TIMING.replayHoldSec;
    const stalled = previous !== undefined && frame.timeMs - previous.timeMs > TIMING.staleFrameMs;
    for (const player of this.players) {
      const target = cellRect(player.grid, HANDS_UP_CELL);
      const raised = frame.players[player.index].hands.some((hand) => insideCell(hand, target));
      if (!raised || stalled) player.holdStartMs = null;
      if (raised && player.holdStartMs === null) player.holdStartMs = frame.timeMs;
      player.hold =
        player.holdStartMs === null ? 0 : Math.min(1, (frame.timeMs - player.holdStartMs) / (holdSec * 1000));
    }
    if (this.players.every((player) => player.hold >= 1)) this.beginCountdown();
  }

  /** Judges every open cue at `timeSec`. With no frame, it only closes cues whose time has passed. */
  private judge(timeSec: number, frame?: TrackingFrame): void {
    for (const player of this.players) {
      const hands = frame?.players[player.index].hands ?? [];
      const opensAheadSec = -LEVELS[player.level].goodMs[0] / 1000;
      for (let i = 0; i < player.states.length; i++) {
        const state = player.states[i];
        if (state.cue.timeSec - opensAheadSec > timeSec) break; // This cue and all later ones are not open yet.
        if (state.result) continue;
        const next = judgeFrame(state, player.level, player.grid, hands, timeSec);
        player.states[i] = next;
        if (next.result) this.award(player, next);
      }
      this.judgeFaceCues(player, timeSec, frame?.players[player.index].face);
    }
  }

  /** The same as for hand cues: with no face, it only closes cues whose time has passed. */
  private judgeFaceCues(player: PlayerRun, timeSec: number, face: TrackedFace | undefined): void {
    const opensAheadSec = -LEVELS[player.level].goodMs[0] / 1000;
    for (let i = 0; i < player.faceStates.length; i++) {
      const state = player.faceStates[i];
      if (state.cue.timeSec - opensAheadSec > timeSec) break; // This cue and all later ones are not open yet.
      if (state.result) continue;
      const next = judgeFaceFrame(state, player.level, face, timeSec);
      player.faceStates[i] = next;
      if (next.result) this.awardFace(player, next.result);
    }
  }

  private award(player: PlayerRun, state: CueState): void {
    const { cue, result } = state;
    if (!result) return;
    player.score = award(player.score, result);
    // A slide shows its result where it ends. A tap shows it on each of its cells.
    const cells = cue.kind === 'slide' ? cue.cells.slice(-1) : cue.cells;
    const atMs = performance.now();
    for (const cell of cells) this.feedback.push({ player: player.index, target: cell, result, atMs });
  }

  /** A face cue scores exactly like a hand cue. Its result shows on the player's face. */
  private awardFace(player: PlayerRun, result: Rating): void {
    player.score = award(player.score, result);
    this.feedback.push({ player: player.index, target: 'face', result, atMs: performance.now() });
  }

  // --- Controls ---

  private async togglePause(): Promise<void> {
    if (this.phase !== 'play' || !this.audio || this.switchingTracker) return;
    try {
      if (this.paused) {
        await this.audio.resume();
        this.paused = false;
        this.ui.showMessage();
      } else {
        await this.audio.pause();
        this.paused = true;
        this.ui.showMessage('Paused', 'Space to keep dancing · Esc for menu');
      }
      this.ui.pauseButton.textContent = this.paused ? '▶ Resume' : 'Ⅱ Pause';
    } catch (error) {
      this.fail(error);
    }
  }

  /** Runs when the player clicks the "Click to start" button after the browser blocked sound. */
  private async unlockAudio(): Promise<void> {
    try {
      await this.audio?.resume();
      if (this.audio?.context.state !== 'running') return;
      this.ui.resumeButton.hidden = true;
      if (this.phase === 'loading') {
        this.beginFit();
      } else if (this.phase === 'play') {
        this.paused = false;
        this.ui.showMessage();
      }
    } catch (error) {
      this.fail(error);
    }
  }

  private askForClick(reason: string): void {
    this.ui.showMessage('Click to start', reason);
    this.ui.resumeButton.hidden = false;
  }

  /** M key: load the next tracker, with the song paused while it loads. */
  private async cycleTracker(): Promise<void> {
    const input = this.input;
    if (!input || this.switchingTracker || this.phase === 'loading') return;
    this.switchingTracker = true;
    const session = this.session;
    const next = TRACKER_CYCLE[(TRACKER_CYCLE.indexOf(this.trackerMode()) + 1) % TRACKER_CYCLE.length];
    const wasPlaying = this.phase === 'play' && !this.paused;
    try {
      if (wasPlaying) {
        await this.audio?.pause();
        this.paused = true;
      }
      this.ui.showMessage('Changing hand tracker…');
      await input.setMode(next);
      if (session !== this.session) {
        input.dispose();
        return;
      }
      this.pickedTracker = next;
      this.ui.showMessage();
      if (wasPlaying) {
        await this.audio?.resume();
        this.paused = false;
      }
    } catch (error) {
      if (session === this.session) this.fail(error);
    } finally {
      this.switchingTracker = false;
    }
  }

  private onKey = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    const key = event.key.toLowerCase();
    const { settings } = this.options;

    switch (key) {
      case 'escape':
        event.preventDefault();
        this.showMenu();
        return;
      case 'f': {
        const toggled = document.fullscreenElement
          ? document.exitFullscreen()
          : document.documentElement.requestFullscreen();
        void toggled.catch(() => {});
        return;
      }
      case 'd':
        this.debugVisible = !this.debugVisible;
        return;
      case 'm':
        void this.cycleTracker();
        return;
      case 'r':
        if (this.phase === 'play') this.beginCountdown();
        return;
      case '[':
      case ']':
        settings.inputLatencyMs += key === ']' ? 10 : -10;
        this.saveSettings();
        return;
      case ',':
      case '.':
        settings.avOffsetMs += key === '.' ? 10 : -10;
        if (this.audio) this.audio.avOffsetMs = settings.avOffsetMs;
        this.saveSettings();
        return;
      case ' ':
      case 'enter':
        this.onActionKey(event, key);
        return;
    }
  };

  /** Space and Enter: the main action of the current phase. */
  private onActionKey(event: KeyboardEvent, key: string): void {
    // In the menu, a focused control keeps its own Space and Enter behaviour.
    const onControl = ['INPUT', 'SELECT', 'BUTTON'].includes((event.target as HTMLElement).tagName);
    if (this.phase === 'menu' && onControl) return;
    if (key === 'enter' && this.phase !== 'menu') return;
    event.preventDefault();

    if (!this.ui.resumeButton.hidden) void this.unlockAudio();
    else if (this.phase === 'menu') void this.start();
    else if (this.phase === 'ready' || this.phase === 'results') this.beginCountdown();
    else if (this.phase === 'play') void this.togglePause();
  }

  // --- Frame loop ---

  private render = (): void => {
    const nowMs = performance.now();
    this.fps = this.fps * 0.9 + (1000 / Math.max(1, nowMs - this.lastRenderMs)) * 0.1;
    this.lastRenderMs = nowMs;
    const elapsedSec = (nowMs - this.phaseStartedMs) / 1000;

    if (this.phase === 'fit') this.updateFit(elapsedSec);
    else if (this.phase === 'countdown') this.updateCountdown(elapsedSec);
    else if (this.phase === 'play') this.updatePlay();
    if (this.phase === 'results') this.ui.updateHold(this.players);

    this.feedback = this.feedback.filter((item) => nowMs - item.atMs < TIMING.feedbackSec * 1000);
    const video = this.input?.video;
    this.renderer.draw(
      {
        phase: this.phase,
        players: this.players,
        frame: this.frame,
        songTimeSec: this.songTime(),
        manifest: this.manifest,
        endSec: this.endSec,
        feedback: this.feedback,
      },
      video ? video.videoWidth / video.videoHeight : 16 / 9,
    );
    this.updateDebug();
    this.expose();
    this.animationId = requestAnimationFrame(this.render);
  };

  private updateFit(elapsedSec: number): void {
    const walkSec = this.walkBackSec();
    const fitLeftSec = walkSec + TIMING.fitSec - elapsedSec;
    if (elapsedSec < walkSec) {
      this.ui.showMessage('Walk back to your spot!', String(Math.ceil(walkSec - elapsedSec)));
    } else if (fitLeftSec > 0) {
      this.ui.showMessage('Draw the biggest circles you can with both arms!', String(Math.ceil(fitLeftSec)));
    } else {
      this.setPhase('ready');
      this.ui.showMessage('Hands up to start!', 'Hold a hand in the glowing cell · Space also starts');
    }
  }

  private updateCountdown(elapsedSec: number): void {
    const leftSec = TIMING.countdownSec - elapsedSec;
    if (leftSec > 0) this.ui.showMessage(String(Math.ceil(leftSec)), 'Here comes the beat!');
    else this.beginPlay();
  }

  private updatePlay(): void {
    if (!this.paused && this.audio?.context.state === 'suspended') {
      // The browser stopped the sound, for example after the tab was hidden.
      this.paused = true;
      this.askForClick('The music stopped. Click to carry on.');
    }
    if (this.paused) return;
    const timeSec = this.songTime();
    // Close judging windows even when the camera stops sending frames. Old hands are never reused.
    this.judge(timeSec - this.options.settings.inputLatencyMs / 1000 - 0.001);
    if (timeSec >= this.endSec) this.finish();
  }

  private updateDebug(): void {
    this.ui.debug.hidden = !this.debugVisible;
    if (!this.debugVisible) return;
    const { settings } = this.options;
    const hands = this.frame?.players.map((player) => player.hands.length).join(' / ') ?? '0 / 0';
    this.ui.debug.textContent = [
      `FPS ${this.fps.toFixed(0)} · inference ${this.frame?.inferenceMs.toFixed(1) ?? '—'} ms`,
      `${this.input?.mode ?? this.trackerMode()} · ${this.input?.delegate ?? '—'}`,
      `Hands ${hands}`,
      ...this.faceDebugLines(),
      `Input ${settings.inputLatencyMs} ms · AV ${settings.avOffsetMs} ms`,
      `Song ${this.songTime().toFixed(3)} s`,
    ].join('\n');
  }

  /**
   * One line for each player with faces on: the strength of each expression in the latest
   * frame. The tracker reads a face only while a face cue is open, so the line shows a dash
   * between cues.
   */
  private faceDebugLines(): string[] {
    const expressions = Object.keys(FACE_EMOJI) as FaceExpression[];
    return this.players
      .filter((player) => player.faces)
      .map((player) => {
        const face = this.frame?.players[player.index].face;
        const strengths = expressions.map((expression) => {
          const strength = face ? face.expressions[expression].toFixed(2) : '—';
          return `${FACE_EMOJI[expression]} ${strength}`;
        });
        return `Face P${player.index + 1} · ${strengths.join(' · ')}`;
      });
  }

  // --- Small helpers ---

  private songTime(): number {
    if (this.phase === 'play') return this.audio?.songTime ?? this.startSec;
    return this.phase === 'results' ? this.endSec : this.startSec;
  }

  private trackerMode(): TrackerMode {
    return this.pickedTracker ?? this.options.tracker ?? DEFAULT_TRACKER[this.options.settings.playerCount];
  }

  /** The test inputs need no walk from the laptop to the play spot. */
  private walkBackSec(): number {
    return this.options.input === 'camera' ? TIMING.walkBackSec : 0;
  }

  private inputView = (): InputView => ({
    phase: this.phase,
    songTimeSec: this.songTime(),
    playerCount: this.options.settings.playerCount,
    players: this.players,
    faceRegions: this.faceRegions(),
  });

  /**
   * Where the tracker looks for each player's face in the next frame. It looks only while
   * one of that player's face cues is open. At all other times the face models do no work,
   * so hand tracking keeps its full speed.
   */
  private faceRegions(): FaceRegions {
    const regions: FaceRegions = [null, null];
    if (this.phase !== 'play') return regions;
    const timeSec = this.songTime();
    for (const player of this.players) {
      const cueIsOpen = openFaceCue(player.faceStates, player.level, timeSec) !== undefined;
      if (cueIsOpen) regions[player.index] = faceRegion(player.grid);
    }
    return regions;
  }

  private saveSettings = (): void => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.options.settings));
    } catch {
      // Storage can be blocked. The game works without it.
    }
  };

  private expose(): void {
    window.__dance = {
      phase: this.phase,
      songTime: this.songTime(),
      players: PLAYER_SLOTS.map((index) => {
        const player = this.players.find((p) => p.index === index);
        if (!player) return { ...freshScore(), level: 0, chart: summariseChart([], []) };
        return { ...player.score, level: player.level, chart: summariseChart(player.cues, player.faceCues) };
      }),
    };
  }

  private dispose(): void {
    this.session++;
    cancelAnimationFrame(this.animationId);
    this.input?.dispose();
    this.audio?.close();
    window.removeEventListener('keydown', this.onKey);
  }
}
