import { errorText } from '../errorText';
import { WORKER_LIMITS } from '../tracking/config';
import type { FaceExpression, FaceRegions, TrackedHand, TrackingFrame } from '../tracking/types';
import { SongAudio } from './audio';
import { addReach, beginReach, circlesMessage, finishReach, KeptGrids, startOnKeptGrids } from './calibration';
import { chartEntries, countMoves, cuesFrom, entriesFrom } from './chart';
import { CHART, DEFAULT_SEED, FACE_EMOJI, HAND_MENU, MENU_TRACKER, SONGS, TIMING, TOAST } from './config';
import { chartMix, cueSetMoveShare, cueSetSeed, CueSetPicker, RANDOM_CUE_SET } from './cueSet';
import { fileNameOf, ratedRoundOf, ratingRecord, saveRating } from './cueSetRating';
import type { RatedRound, SetRating } from './cueSetRating';
import { buildRunReport, newFaceObservation, newObservation, newTrackingStats } from './diagnostics';
import type { RunReport, TrackingStats } from './diagnostics';
import { generateFaceCues } from './faceChart';
import { needsFace, newFaceCueState } from './faceJudgment';
import { fitMomentAt, planFit } from './fitTiming';
import type { FitPlan } from './fitTiming';
import { logEntry } from './frameLog';
import type { LoggedFrame } from './frameLog';
import { containRect, faceRegion } from './geometry';
import type { MenuHand } from './handMenu';
import { clearCalibrateHolds, clearHolds, stepCalibrateHolds, stepHandsUp, stepWaitingHolds } from './handsUp';
import type { InputView } from './input';
import { InputHost } from './inputHost';
import { closingSongTime, frameSongTime, newCueState } from './judgment';
import { fetchManifest, playEndSec, playStartSec } from './manifest';
import { createPlayers, summariseChart } from './player';
import type { ChartSummary, PlayerRun } from './player';
import { chooseInTurn, newPlayerPointers, stepPlayerPointers } from './playerPointers';
import { inCurrentStretch, pausePlay, resumePlay } from './playTime';
import { MenuPreview } from './preview';
import type { PreviewState } from './preview';
import { GameRenderer } from './render';
import type { Feedback } from './render';
import { endCard } from './recordingScene';
import { judgePlayers } from './roundJudging';
import { recordingTailSec, RoundRecordings } from './roundRecordings';
import { freshScore } from './scoring';
import { parseSettings, STORAGE_KEY, usesFaces } from './settings';
import type { Options } from './settings';
import { mergeForSolo } from './solo';
import type { Manifest, Phase, PlayerIndex, Point, Score } from './types';
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
  /** The diagnostics of the last finished run. */
  report?: RunReport;
  /** The song preview of the menu. */
  preview: PreviewState;
  /** With `framelog=1`: every tracking frame since the page loaded. */
  frameLog?: LoggedFrame[];
}
declare global {
  interface Window {
    __dance: PublicState;
  }
}

const PLAYER_SLOTS: readonly PlayerIndex[] = [0, 1];

function readStoredSettings(): unknown {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    return null; // Storage can be blocked or hold bad data. The defaults apply.
  }
}

/**
 * Runs the game through its phases:
 * menu → loading → ready → countdown → play → results.
 * Results loop back to countdown on replay. Esc returns to the menu from anywhere.
 * A calibration (the fit phase) comes between them only when players ask for it: from the
 * ready screen, with the C key, or with the Recalibrate button of the results. It ends on the
 * ready screen.
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
  /** The host of the input: it opens, switches and closes the camera or a test input. */
  private readonly inputs: InputHost;
  /** Whether hand control was on at the last look from the menu. See `syncMenuInput`. */
  private menuHandControl = false;
  /**
   * True when a hand began the current calibration: a hand held in a Calibrate cell, or a fist
   * on the Recalibrate button of the results. It sets the calibration's timing: see `planFit`.
   */
  private fitBegunByHand = false;
  /**
   * The players whose grids the current calibration fits: every player for the C key and the
   * Recalibrate button of the results, one player for a Calibrate cell.
   */
  private calibrating: PlayerIndex[] = [];
  /**
   * Players whose Calibrate hold completed while another player calibrated. They calibrate
   * next, in this order.
   */
  private calibrationQueue: PlayerIndex[] = [];
  /** The grid of each player's last calibration, until the page reloads. */
  private readonly keptGrids = new KeptGrids();
  /**
   * Each player's pointer: which item their hands are on, and how far their fist hold has come.
   * In the menu and the results, and in the video player.
   */
  private pointers = newPlayerPointers(PLAYER_SLOTS.length);
  private manifest?: Manifest;
  private players: PlayerRun[] = [];
  /** The latest tracking frame, after the one-player merge. */
  private frame?: TrackingFrame;
  private feedback: Feedback[] = [];
  private startSec = 0;
  private endSec = 0;
  /** The chart seed of the round: from its cue set, or from the URL. */
  private seed = DEFAULT_SEED;
  /** The cue set the seed came from. Null when the URL gave the seed. */
  private cueSet: number | null = null;
  /** True when the round's set was picked at random. */
  private cueSetRandom = false;
  /** Picks the set of each round from the menu, and keeps the last set of each song. */
  private readonly cueSets = new CueSetPicker();
  /** The share of phrases in busy music that hold a move: from the cue set, or from the URL. */
  private moveShare = 0;
  private paused = false;

  /** Totals about tracking during the current run, and the report of the last finished run. */
  private trackingStats: TrackingStats = newTrackingStats(0);
  private report?: RunReport;
  /** What the ratings of the last finished round share. Null when that round has nothing to rate. */
  private ratedRound: RatedRound | null = null;
  /** With `framelog=1`: every tracking frame, for scripts that compare runs. */
  private readonly frameLog: LoggedFrame[] = [];

  private switchingTracker = false;

  /** Records the rounds while recording is on, and holds the videos of the round on the results. */
  private readonly recordings = new RoundRecordings(() => this.onRecordingsChange());
  private readonly preview = new MenuPreview();

  private debugVisible = false;
  private fps = 60;
  private lastRenderMs = performance.now();
  private animationId = 0;

  constructor(root: HTMLElement) {
    this.ui = new GameUI(root);
    this.renderer = new GameRenderer(this.ui.canvas);
    this.options = parseSettings(readStoredSettings(), location.search);
    this.inputs = new InputHost(this.options, this.ui.stage, {
      view: this.inputView,
      onFrame: this.onTrackingFrame,
      onFailure: this.onTrackingFailure,
    });

    this.ui.pauseButton.addEventListener('click', () => void this.togglePause());
    this.ui.restartButton.addEventListener('click', () => this.restartRound());
    this.ui.menuButton.addEventListener('click', () => this.showMenu());
    this.ui.resumeButton.addEventListener('click', () => void this.unlockAudio());
    this.ui.fullscreenButton.addEventListener('click', () => this.toggleFullscreen());
    document.addEventListener('fullscreenchange', this.showFullscreenButton);
    this.showFullscreenButton();
    this.ui.player.onChange = this.onPlayerChange;
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
    clearHolds(this.players);
    // A calibration of one player leaves the Calibrate holds of the others alone, and so does
    // the next calibration of the queue: see `trackWaitingHolds`. Any other phase ends them.
    if (phase !== 'fit') {
      clearCalibrateHolds(this.players);
      this.calibrationQueue = [];
    }
    this.ui.player.close();
    this.ui.pauseButton.hidden = phase !== 'play';
    this.ui.restartButton.hidden = phase !== 'play';
    // The menu and the results have their own ways out. Every other phase needs one for a touch.
    this.ui.menuButton.hidden = phase === 'menu' || phase === 'results';
    this.clearHandPointer();
    document.body.dataset.phase = phase; // The stylesheet places messages by phase.
    this.expose();
  }

  private showMenu = (): void => {
    this.endRecording();
    this.session++;
    this.audio?.close();
    this.audio = undefined;
    this.players = [];
    this.frame = undefined;
    this.paused = false;
    this.switchingTracker = false;
    this.ui.resumeButton.hidden = true;
    this.setPhase('menu');
    this.ui.showMenu(this.options.settings, () => void this.start(), this.onMenuChange);
    this.followPreview();
    // A menu that opens is a new chance for the camera, as if hand control had just been turned on.
    this.menuHandControl = false;
    this.syncMenuInput();
  };

  /** A choice in the menu changed. */
  private onMenuChange = (): void => {
    this.saveSettings();
    this.followPreview();
    this.syncMenuInput();
  };

  /**
   * In the menu, the camera runs only while hands can point at the menu. With hand control
   * off it is released: the camera light goes out, the picture behind the menu goes, and no
   * tracking runs. The round opens the camera again when it starts.
   *
   * A camera that could not open (a dismissed prompt, no camera) is tried again only when the
   * menu opens or hand control is turned on. Each try asks for the camera and loads the models,
   * which must not happen on every choice in the menu.
   */
  private syncMenuInput(): void {
    if (this.phase !== 'menu') return;
    const { handControl } = this.options.settings;
    const turnedOn = handControl && !this.menuHandControl;
    this.menuHandControl = handControl;
    if (!handControl) {
      void this.inputs.want(null);
      this.frame = undefined;
      this.clearHandPointer();
      return;
    }
    if (!turnedOn && !this.inputs.input) return;
    // If tracking cannot start, the menu still works with the mouse and the keyboard.
    this.inputs.want({ mode: MENU_TRACKER, faces: false }).catch(() => {});
  }

  /** Takes the hand rings and the highlights off the panel, and forgets every hold in progress. */
  private clearHandPointer(): void {
    this.pointers = newPlayerPointers(PLAYER_SLOTS.length);
    this.ui.showHands([], []);
  }

  /**
   * Makes sure tracking runs, with the tracker that suits the number of players. An input
   * that the menu opened stays open, so a round starts with no camera delay. A round that
   * opens the input loads its own tracker at once, not the menu's first.
   */
  private async prepareTracking(): Promise<void> {
    await this.inputs.want({ mode: this.inputs.trackerMode(), faces: usesFaces(this.options.settings) });
    if (!this.inputs.input) throw this.inputs.error ?? new Error('The camera did not start.');
  }

  /**
   * Tracking broke while running. In a round, that ends the round. In the menu, it ends
   * pointing: the rings and the highlight go, and a note says how to try again. The menu
   * opens the camera again only when hand control is turned on (see `syncMenuInput`).
   */
  private onTrackingFailure = (error: unknown): void => {
    if (this.phase !== 'menu') {
      this.fail(error);
      return;
    }
    this.frame = undefined;
    this.clearHandPointer();
    // The note is a sentence to read from the dance spot: it stays a while.
    this.ui.showToast('Hand control stopped. Turn it off and on to try again.', TOAST.longMs);
  };

  /**
   * Loads the song and the tracker for this round, then shows the ready screen. Each player
   * starts on the grid of their last calibration, or on the standard grid.
   */
  private async start(): Promise<void> {
    if (this.phase !== 'menu') return;
    this.saveSettings();
    this.preview.follow(null);
    this.setPhase('loading');
    this.ui.hidePanel();
    this.ui.showMessage('Getting the dance floor ready…', 'Loading the song and the hand models');

    const session = this.session;
    const { settings } = this.options;
    const audio = new SongAudio();
    audio.setOffsets(settings.avOffsetMs, settings.inputLatencyMs);
    this.audio = audio;
    // Browsers allow sound only after a click or key press. Resume now, inside the Start
    // gesture, before the first await. If it fails, the "Click to start" button retries.
    void audio.resume().catch(() => {});

    try {
      const [song, tracking] = await Promise.allSettled([this.loadSong(audio), this.prepareTracking()]);
      if (!this.stillLoading(session)) return;
      if (song.status === 'rejected') throw song.reason;
      if (tracking.status === 'rejected') throw tracking.reason;

      const manifest = song.value;
      this.manifest = manifest;
      this.endSec = playEndSec(manifest, settings.length);
      // The URL can start the song anywhere, for tests. Otherwise the song sets its own start.
      this.startSec = this.options.startSec > 0 ? this.options.startSec : playStartSec(manifest, settings.length);
      if (this.startSec >= this.endSec) {
        throw new Error(`The start offset must be below the play length (${this.endSec.toFixed(1)} seconds).`);
      }

      this.players = createPlayers(settings);
      startOnKeptGrids(this.players, this.keptGrids, settings.playerCount);
      this.chooseCueSet(manifest);
      for (const player of this.players) {
        const chart = chartEntries(manifest, {
          level: player.level,
          shapes: player.shapes,
          seed: this.seed,
          endSec: this.endSec,
          moves: this.moveShare,
          // The round's first cue may come this late: no move starts before it, so the round
          // never begins with the rest of a move.
          movesFromSec: this.startSec + CHART.leadSec,
        });
        const played = entriesFrom(chart, this.startSec);
        player.cues = played.map((entry) => entry.cue);
        player.moves = countMoves(played);
        player.mix = chartMix(manifest, played, player.level);
        if (player.faces) {
          const faceCues = generateFaceCues(manifest, this.seed, this.endSec);
          player.faceCues = cuesFrom(faceCues, this.startSec);
        }
      }

      if (audio.context.state === 'suspended') {
        this.askForClick('Your browser needs a click to turn on the music.');
      } else {
        this.showReady();
      }
    } catch (error) {
      this.failIfCurrent(session, error);
    }
  }

  /**
   * Sets the chart seed of the round and its share of moves. A seed in the URL wins, for tests,
   * and plays without moves. Otherwise the cue set gives both: the seed for the part of the
   * song that the length plays, so a start in the URL keeps the cues of the real round. A
   * share in the URL wins over both.
   *
   * Only a round from the menu comes here. "Play again" and a restart keep the cues, and with
   * them the set, of the round before.
   */
  private chooseCueSet(manifest: Manifest): void {
    const { settings, seed, moves } = this.options;
    if (seed !== undefined) {
      this.cueSet = null;
      this.cueSetRandom = false;
      this.seed = seed;
      this.moveShare = moves ?? 0;
      return;
    }
    const set = this.cueSets.setForRound(manifest.id, settings.cueSet);
    this.cueSet = set;
    this.cueSetRandom = settings.cueSet === RANDOM_CUE_SET;
    this.seed = cueSetSeed(set, {
      manifest,
      players: this.players,
      startSec: playStartSec(manifest, settings.length),
      endSec: this.endSec,
    });
    this.moveShare = moves ?? cueSetMoveShare(set);
  }

  /**
   * True while `session` still loads. The player may have left for the menu meanwhile, or a
   * failure may have ended the loading: a tracker that broke while the song still decoded.
   * A failure does not start a new session.
   */
  private stillLoading(session: number): boolean {
    return session === this.session && this.phase === 'loading';
  }

  private async loadSong(audio: SongAudio): Promise<Manifest> {
    const manifest = await fetchManifest(SONGS[this.options.settings.songIndex].manifest);
    await audio.load(manifest.audio);
    return manifest;
  }

  // --- Recording a round as video ---

  /**
   * The results close, or a round stops part-way (a restart, the menu, an error). The game
   * keeps no videos: the round's recording is thrown away, with its videos. The video player
   * closes first, so it plays no video that goes.
   */
  private endRecording(): void {
    this.ui.player.close();
    this.recordings.drop();
  }

  /** A recording started or ended, or its videos moved on a stage. */
  private onRecordingsChange(): void {
    this.ui.showRecordingMark(this.recordings.active);
    this.ui.showRecordings(this.recordings.view(performance.now()));
  }

  /**
   * The video player opened or closed. While it is open, a raised hand must not start a new
   * round, and the menu's song preview must not play over the video.
   */
  private onPlayerChange = (): void => {
    clearHolds(this.players);
    this.followPreview();
  };

  // --- Song preview in the menu ---

  /**
   * Plays a part of the chosen song while the menu is open, unless the player turned previews
   * off or the video player is open. Call it when any of these changes.
   */
  private followPreview(): void {
    const { songIndex, previews } = this.options.settings;
    const isOn = this.phase === 'menu' && previews && !this.ui.player.isOpen;
    this.preview.follow(isOn ? songIndex : null);
  }

  /**
   * The ready screen: the grids, with each player's Start cell and Calibrate cell. A hand held
   * in every Start cell, or Space, starts the countdown.
   */
  private showReady(): void {
    this.ui.resumeButton.hidden = true;
    this.setPhase('ready');
    this.ui.showMessage('Hands up to start!', 'Hold a hand in the Start cell · Space also starts');
  }

  /**
   * Calibrates every player again, from the calibration itself or from any later phase of the
   * round: the C key, and the Recalibrate button of the results. The round then goes on from
   * the ready screen, with the same cues.
   * `byHand` says that a pointing hand asked for it: the players then stand at their spots
   * already, and the calibration waits a moment for that hand to leave the button (see `planFit`).
   */
  private refit(byHand = false): void {
    const inRound = ['fit', 'ready', 'countdown', 'play', 'results'].includes(this.phase);
    if (!inRound || this.switchingTracker) return;
    this.resetRound();
    this.fitBegunByHand = byHand;
    this.calibrating = this.players.map((player) => player.index);
    this.calibrationQueue = [];
    clearCalibrateHolds(this.players);
    this.beginFit();
  }

  /**
   * Calibrates one player, who held a hand in their Calibrate cell. Only that player's grid
   * changes. The hand is still in the cell, so the circles wait a moment for it to leave (see
   * `planFit`). The Calibrate holds of the other players go on.
   */
  private calibrateOne(index: PlayerIndex): void {
    const player = this.players.find((candidate) => candidate.index === index);
    if (!player) return;
    this.fitBegunByHand = true;
    this.calibrating = [index];
    clearCalibrateHolds([player]);
    this.beginFit();
  }

  /** Begins the calibration of the players in `calibrating`: their grids go back to the standard grid. */
  private beginFit(): void {
    beginReach(this.players, this.calibrating, this.options.settings.playerCount);
    this.ui.resumeButton.hidden = true;
    this.setPhase('fit');
  }

  /**
   * The circles are over. Each calibrated grid is kept for later rounds. Then the next player
   * in the queue calibrates, or the ready screen shows.
   */
  private endFit(): void {
    finishReach(this.players, this.calibrating, this.keptGrids, this.options.settings.playerCount);
    const next = this.calibrationQueue.shift();
    if (next === undefined) this.showReady();
    else this.calibrateOne(next);
  }

  /** Starts the round in play again: the same cues, from the countdown. A paused round too. */
  private restartRound(): void {
    if (this.phase === 'play') this.beginCountdown();
  }

  /** Starts, or restarts, the song from its 3-2-1 countdown. Keeps the fitted grids. */
  private beginCountdown = (): void => {
    if (this.phase !== 'ready' && this.phase !== 'results' && this.phase !== 'play') return;
    this.resetRound();
    for (const player of this.players) {
      player.score = freshScore();
      player.states = player.cues.map(newCueState);
      player.observations = player.cues.map(newObservation);
      player.faceStates = player.faceCues.map(newFaceCueState);
      player.faceObservations = player.faceCues.map(newFaceObservation);
    }
    this.setPhase('countdown');
    this.beginRecording();
  };

  /**
   * Stops what runs of a round before it starts again, from its fit or from its countdown:
   * the recording, the song, a pause, the flashes of cues, and the panel.
   */
  private resetRound(): void {
    const session = this.session;
    this.endRecording();
    this.audio?.stop();
    // A paused round has a stopped audio clock. The next countdown needs it running.
    void this.audio?.resume().catch((error: unknown) => this.failIfCurrent(session, error));
    this.paused = false;
    this.feedback = [];
    this.ui.hidePanel();
  }

  /** Tells the recordings that a round begins. It is recorded when the players turned recording on. */
  private beginRecording(): void {
    const { settings } = this.options;
    const audio = this.audio;
    if (!settings.record || !audio) {
      this.recordings.begin();
      return;
    }
    this.recordings.begin({
      sound: audio.recordingStreams(),
      video: this.inputs.input?.video,
      songId: this.manifest?.id ?? 'song',
    });
  }

  private beginPlay(): void {
    try {
      // Fade out only when the round stops inside the song. A round that reaches the end of
      // the song ends with the song's own ending.
      const stopsInsideSong = this.manifest !== undefined && this.endSec < this.manifest.durationSec - 0.5;
      this.audio?.play(this.startSec, this.endSec, stopsInsideSong);
    } catch (error) {
      this.fail(error);
      return;
    }
    this.trackingStats = newTrackingStats(performance.now());
    this.setPhase('play');
    this.ui.pauseButton.textContent = 'Ⅱ Pause';
    this.ui.showMessage();
  }

  private finish(): void {
    this.judge(this.endSec + 1); // Closes every cue that is still open.
    this.report = this.buildReport();
    this.ratedRound = this.roundToRate();
    this.audio?.stop();
    this.setPhase('results');
    this.ui.showResults(this.players, this.cueSet, {
      onReplay: this.beginCountdown,
      onMenu: this.showMenu,
      onRefit: (byHand) => this.refit(byHand),
      onRate: this.ratedRound ? this.rate : undefined,
    });
    // A recording goes on for a few seconds: the cheer, and the result card in the game view.
    const tailSec = recordingTailSec(this.audio?.soundDelays ?? { game: 0, camera: 0 });
    this.recordings.endAfter(tailSec, performance.now());
    if (import.meta.env.DEV) void this.saveReport(this.report, this.ratedRound);
  }

  /**
   * What the players' ratings of the round that just ended share. Null when there is nothing
   * to rate: a round with no cue set. Null in a build with no dev server, too, which could not
   * keep a rating.
   */
  private roundToRate(): RatedRound | null {
    if (!import.meta.env.DEV) return null;
    const { settings } = this.options;
    const ended = {
      endedAt: new Date(),
      songId: this.manifest?.id ?? '',
      length: settings.length,
      playerCount: settings.playerCount,
      cueSet: this.cueSet,
      seed: this.seed,
      cueSetRandom: this.cueSetRandom,
      moveShare: this.moveShare,
    };
    return ratedRoundOf(ended, Math.random);
  }

  /** Saves a player's rating of the round's cue set at once. Answers whether the dev server kept it. */
  private rate = (index: PlayerIndex, rating: SetRating): Promise<boolean> => {
    const round = this.ratedRound;
    const player = this.players.find((candidate) => candidate.index === index);
    if (!round || !player) return Promise.resolve(false);
    return saveRating(ratingRecord(round, player, rating, new Date()));
  };

  private buildReport(): RunReport {
    const { settings } = this.options;
    return buildRunReport({
      song: {
        id: this.manifest?.id ?? '',
        title: this.manifest?.title ?? '',
        length: settings.length,
        startSec: this.startSec,
        endSec: this.endSec,
      },
      settings: {
        playerCount: settings.playerCount,
        input: this.options.input,
        seed: this.seed,
        cueSet: this.cueSet,
        cueSetRandom: this.cueSetRandom,
        moveShare: this.moveShare,
        inputLatencyMs: settings.inputLatencyMs,
        avOffsetMs: settings.avOffsetMs,
        audioOutputLatencyMs: Math.round((this.audio?.outputLatencySec ?? 0) * 1000),
        recording: this.recordings.active,
      },
      trackerMode: this.inputs.input?.mode ?? this.inputs.trackerMode(),
      trackerDelegate: this.inputs.input?.delegate ?? '',
      trackerFaceDelegate: this.inputs.input?.faceDelegate ?? null,
      trackerThread: this.inputs.input?.thread ?? null,
      players: this.players,
      stats: this.trackingStats,
      nowMs: performance.now(),
    });
  }

  /**
   * Dev server only: saves the run report to `test-results/` on disk and offers it for copying,
   * so a run can be studied afterwards without reading numbers off the screen. The ratings of
   * the round name the report's file once it is saved.
   */
  private async saveReport(report: RunReport, round: RatedRound | null): Promise<void> {
    const json = JSON.stringify(report);
    this.ui.showDiagnostics(json, 'Saving diagnostics…');
    try {
      const response = await fetch('/__run-diagnostics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const saved: { path: string } = await response.json();
      if (round) round.runReport = fileNameOf(saved.path);
      this.ui.showDiagnostics(json, `Diagnostics saved: ${saved.path}`);
    } catch (error) {
      this.ui.showDiagnostics(json, `Diagnostics not saved (${errorText(error)}). Copy them instead.`);
    }
  }

  private fail(error: unknown): void {
    this.endRecording();
    this.audio?.stop();
    this.setPhase('error');
    this.ui.hidePanel();
    this.ui.resumeButton.hidden = true;
    this.ui.showMessage('The dance floor needs a hand', `${errorText(error)} Press Esc to return to the menu.`);
  }

  /**
   * Reports an error from work that takes a moment (audio, models), unless the player has
   * left that session meanwhile. A late failure must never replace the menu or a new game.
   */
  private failIfCurrent(session: number, error: unknown): void {
    if (session === this.session) this.fail(error);
  }

  // --- Tracking frames ---

  private onTrackingFrame = (raw: TrackingFrame): void => {
    if (this.options.frameLog) {
      const { input } = this.inputs;
      const source = { mode: input?.mode ?? '', thread: input?.thread ?? null, delegate: input?.delegate ?? '' };
      this.frameLog.push(logEntry(raw, this.phase, source));
    }
    const frame = this.options.settings.playerCount === 1 ? mergeForSolo(raw) : raw;
    const previous = this.frame;
    this.frame = frame;
    this.rememberFaces(frame);

    // The ready screen has nothing to point at: its choices are cells of the grids.
    const pointsAtPanel = this.phase === 'menu' || this.phase === 'results';
    if (this.options.settings.handControl && pointsAtPanel) this.pointAtPanel(frame);

    if (this.phase === 'fit') {
      this.collectReach(frame);
      this.trackWaitingHolds(frame, previous);
    } else if (this.phase === 'ready') {
      this.trackReadyHolds(frame, previous);
    } else if (this.phase === 'results' && !this.ui.player.isOpen) {
      this.trackReplayHold(frame, previous);
    } else if (this.isFrameOfPlay(frame)) {
      this.countFrame(frame);
      const { inputLatencyMs } = this.options.settings;
      this.judge(frameSongTime(this.songTime(), performance.now(), frame.timeMs, inputLatencyMs), frame);
    }
  };

  /**
   * True when a frame counts for play and for judging. A frame taken before the current stretch
   * of play began, at the start of play or at the last resume, does not: its age would count
   * the pause as play. A tracking worker can deliver such a frame after the stretch began. It
   * still moves the hand rings.
   */
  private isFrameOfPlay(frame: TrackingFrame): boolean {
    if (this.phase !== 'play' || this.paused || this.audio?.context.state !== 'running') return false;
    return inCurrentStretch(this.trackingStats.play, frame.timeMs);
  }

  /** Keeps where each face was last found. A face cue is drawn there, on the player's own face. */
  private rememberFaces(frame: TrackingFrame): void {
    for (const player of this.players) {
      const face = frame.players[player.index].face;
      if (face) player.faceSeenAt = { x: face.x, y: face.y };
    }
  }

  /**
   * An open hand highlights an item on screen, a fist held on it chooses it. Each player's
   * hands move a pointer of their own (see playerPointers.ts), so two players can point at
   * two items at once. A ring shows at each hand.
   */
  private pointAtPanel(frame: TrackingFrame): void {
    const handsByPlayer = frame.players.map((player) => this.pointingHands(player.hands));
    const step = stepPlayerPointers(this.pointers, this.ui.handTargets(), handsByPlayer, frame.timeMs);
    this.pointers = step.states;
    this.ui.showHands(handsByPlayer.flat(), step.hovers);
    chooseInTurn(step.chooseIds, (id) => this.ui.chooseHandTarget(id), this.handScreen);
  }

  /** The hands that point, as screen positions. Hands low in the frame are resting. */
  private pointingHands(hands: readonly TrackedHand[]): MenuHand[] {
    return hands
      .filter((hand) => hand.y <= HAND_MENU.lowestY)
      .map((hand) => ({ ...this.toScreen(hand), fist: hand.gesture === 'fist' }));
  }

  /** What the hands point at: the phase, the open panel and the video player. A choice may change it. */
  private handScreen = (): string => `${this.phase} ${this.ui.handScreen}`;

  /** A point in the camera frame, as a position on the screen in pixels. */
  private toScreen(point: Point): Point {
    const bounds = this.ui.stage.getBoundingClientRect();
    const frame = containRect(bounds.width, bounds.height, this.videoAspect());
    return {
      x: bounds.left + frame.x + point.x * frame.width,
      y: bounds.top + frame.y + point.y * frame.height,
    };
  }

  /** Calibration: grows the grid of each player who calibrates around the hand positions seen so far. */
  private collectReach(frame: TrackingFrame): void {
    // Ignore hands while the players walk from the laptop to their spots, and while a hand
    // that chose leaves the Calibrate cell or the Recalibrate button.
    const elapsedSec = (performance.now() - this.phaseStartedMs) / 1000;
    if (!fitMomentAt(this.fitPlan(), elapsedSec).handsCount) return;
    addReach(this.players, this.calibrating, frame, this.options.settings.playerCount);
  }

  /**
   * Ready screen: the round starts when every player holds a hand in their Start cell. A hand
   * held in a Calibrate cell calibrates that player. When two holds complete in one frame,
   * the second player waits for the first.
   */
  private trackReadyHolds(frame: TrackingFrame, previous: TrackingFrame | undefined): void {
    if (stepHandsUp(this.players, frame, previous, TIMING.readyHoldSec)) {
      this.beginCountdown();
      return;
    }
    const [first, ...others] = stepCalibrateHolds(this.players, frame, previous, TIMING.calibrateHoldSec);
    if (!first) return;
    this.calibrateOne(first.index);
    this.calibrationQueue = others.map((player) => player.index);
  }

  /**
   * Calibration of one player: the Calibrate hold that another player began on the ready
   * screen goes on. When it completes, that player calibrates next.
   */
  private trackWaitingHolds(frame: TrackingFrame, previous: TrackingFrame | undefined): void {
    const completed = stepWaitingHolds(
      this.players,
      this.calibrating,
      this.calibrationQueue,
      frame,
      previous,
      TIMING.calibrateHoldSec,
    );
    this.calibrationQueue.push(...completed.map((player) => player.index));
  }

  /** Results: the next round starts when every player holds a hand in their Start cell. */
  private trackReplayHold(frame: TrackingFrame, previous: TrackingFrame | undefined): void {
    if (stepHandsUp(this.players, frame, previous, TIMING.replayHoldSec)) this.beginCountdown();
  }

  private countFrame(frame: TrackingFrame): void {
    const stats = this.trackingStats;
    stats.frames++;
    stats.inferenceMs.push(frame.inferenceMs);
    for (const player of this.players) {
      const handCount = Math.min(2, frame.players[player.index].hands.length);
      stats.handCounts[player.index][handCount]++;
    }
  }

  /** Judges every open cue at `timeSec`, and flashes each result. With no frame, it only closes cues whose time has passed. */
  private judge(timeSec: number, frame?: TrackingFrame): void {
    this.feedback.push(...judgePlayers(this.players, timeSec, frame, performance.now()));
  }

  // --- Controls ---

  /**
   * Pauses the round: the song stops, and with it the song clock, and the recording leaves
   * the pause out. Every pause of a round goes through here, so the three always agree.
   */
  private async pauseRound(): Promise<void> {
    this.paused = true;
    this.trackingStats.play = pausePlay(this.trackingStats.play, performance.now());
    this.recordings.pause();
    await this.audio?.pause();
  }

  /** Plays the round on: the song, its clock and the recording go on together. */
  private async resumeRound(): Promise<void> {
    const session = this.session;
    await this.audio?.resume();
    // The player may have left the round while the sound came back, or it may not have come back.
    if (session !== this.session || this.audio?.context.state !== 'running') return;
    this.paused = false;
    this.trackingStats.play = resumePlay(this.trackingStats.play, performance.now());
    this.recordings.resume();
  }

  private async togglePause(): Promise<void> {
    if (this.phase !== 'play' || !this.audio || this.switchingTracker) return;
    const session = this.session;
    try {
      await (this.paused ? this.resumeRound() : this.pauseRound());
    } catch (error) {
      this.failIfCurrent(session, error);
      return;
    }
    if (session !== this.session) return; // The player left for the menu while the audio switched.

    if (this.paused) this.ui.showMessage('Paused', 'Space to keep dancing · Esc for menu');
    else this.ui.showMessage();
    this.ui.pauseButton.textContent = this.paused ? '▶ Resume' : 'Ⅱ Pause';
  }

  /** Runs when the player clicks the "Click to start" button after the browser blocked sound. */
  private async unlockAudio(): Promise<void> {
    const audio = this.audio;
    if (!audio) return;
    const session = this.session;
    try {
      await (this.phase === 'play' ? this.resumeRound() : audio.resume());
    } catch (error) {
      this.failIfCurrent(session, error);
      return;
    }
    if (session !== this.session || audio.context.state !== 'running') return;

    this.ui.resumeButton.hidden = true;
    if (this.phase === 'loading') this.showReady();
    else if (this.phase === 'play') this.ui.showMessage();
  }

  private askForClick(reason: string): void {
    this.ui.showMessage('Click to start', reason);
    this.ui.resumeButton.hidden = false;
  }

  /** M key: load the next tracker, with the song paused while it loads. */
  private async cycleTracker(): Promise<void> {
    if (!this.inputs.input || this.switchingTracker || this.phase === 'loading') return;
    this.switchingTracker = true;
    const session = this.session;
    const wasPlaying = this.phase === 'play' && !this.paused;
    // After every wait, stop if the player has left for the menu: the session is then stale.
    try {
      if (wasPlaying) {
        await this.pauseRound();
        if (session !== this.session) return;
      }
      this.ui.showMessage('Changing hand tracker…');
      await this.inputs.pickNextTracker(usesFaces(this.options.settings));
      if (session !== this.session) return;
      this.ui.showMessage();
      if (wasPlaying) await this.resumeRound();
    } catch (error) {
      this.failIfCurrent(session, error);
    } finally {
      if (session === this.session) this.switchingTracker = false;
    }
  }

  /**
   * Makes the page full screen, or leaves full screen. A browser allows this only from a key,
   * a click or a touch, so a hand in the camera cannot do it.
   */
  private toggleFullscreen(): void {
    if (!document.fullscreenEnabled) return;
    const toggled = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();
    void toggled.catch(() => {});
  }

  /**
   * Shows the full-screen button while the page can go full screen and is not full screen.
   * In full screen the button would only cover the game: F, Esc or the browser's own control
   * leaves it.
   */
  private showFullscreenButton = (): void => {
    this.ui.fullscreenButton.hidden = !document.fullscreenEnabled || document.fullscreenElement !== null;
  };

  private onKey = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    const key = event.key.toLowerCase();
    const { settings } = this.options;

    // The open video player takes the keys: Esc closes it, Space pauses it, and no key
    // starts or leaves a round behind it. Space on one of its buttons presses that button.
    if (this.ui.player.isOpen) {
      if (key === 'escape') this.ui.player.close();
      else if (key === ' ' && !this.ui.player.isOwnControl(event.target)) this.ui.player.togglePause();
      else return;
      event.preventDefault();
      return;
    }

    switch (key) {
      case 'escape':
        event.preventDefault();
        this.showMenu();
        return;
      case 'f':
        this.toggleFullscreen();
        return;
      case 'd':
        this.debugVisible = !this.debugVisible;
        return;
      case 'm':
        void this.cycleTracker();
        return;
      case 'r':
        this.restartRound();
        return;
      case 'c':
        this.refit();
        return;
      case 'arrowleft':
      case 'arrowright':
        // In the menu, the arrow keys step through the songs. A focused control keeps its own arrows.
        if (this.phase === 'menu' && (event.target as HTMLElement).tagName !== 'INPUT') {
          this.ui.stepSong(key === 'arrowright' ? 1 : -1);
        }
        return;
      case '[':
      case ']':
        settings.inputLatencyMs += key === ']' ? 10 : -10;
        this.audio?.setOffsets(settings.avOffsetMs, settings.inputLatencyMs);
        this.saveSettings();
        return;
      case ',':
      case '.':
        settings.avOffsetMs += key === '.' ? 10 : -10;
        this.audio?.setOffsets(settings.avOffsetMs, settings.inputLatencyMs);
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
    if (this.phase === 'play' && !this.paused) this.trackingStats.drawnFrames++;
    if (this.phase === 'results') this.ui.updateHold(this.players);

    this.feedback = this.feedback.filter((item) => nowMs - item.atMs < TIMING.feedbackSec * 1000);
    this.renderer.draw(
      {
        phase: this.phase,
        players: this.players,
        frame: this.frame,
        songTimeSec: this.songTime(),
        manifest: this.manifest,
        startSec: this.startSec,
        endSec: this.endSec,
        feedback: this.feedback,
        recording: this.recordings.active,
      },
      this.videoAspect(),
    );
    // The scene of the game view is built only while a recording needs it.
    if (this.recordings.active) {
      this.recordings.drawFrame({
        video: this.inputs.input?.video,
        overlay: this.ui.canvas,
        frame: this.renderer.framePixels,
        message: this.ui.message,
        results: this.phase === 'results' ? endCard(this.players, this.cueSet) : undefined,
      });
    }
    this.updateDebug();
    this.expose();
    this.animationId = requestAnimationFrame(this.render);
  };

  private updateFit(elapsedSec: number): void {
    const { stage, secondsLeft } = fitMomentAt(this.fitPlan(), elapsedSec);
    if (stage === 'walk') {
      this.ui.showMessage('Walk back to your spot!', String(secondsLeft));
    } else if (stage === 'draw') {
      const { playerCount } = this.options.settings;
      this.ui.showMessage(circlesMessage(this.calibrating, playerCount), String(secondsLeft));
    } else {
      this.endFit();
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
      const session = this.session;
      void this.pauseRound().catch((error: unknown) => this.failIfCurrent(session, error));
      this.askForClick('The music stopped. Click to carry on.');
    }
    if (this.paused) return;
    // Close judging windows even when the camera stops sending frames. Old hands are never
    // reused. A frame that a tracking worker still works on keeps the windows open for it, up
    // to the limit after which the worker counts as stuck. A frame from before this stretch of
    // play is not judged, so it keeps nothing open.
    const stretchStartedMs = this.trackingStats.play.stretchStartedMs ?? performance.now();
    const pendingFrameMs = this.inputs.input?.pendingFrameMs?.(stretchStartedMs);
    const { inputLatencyMs } = this.options.settings;
    this.judge(closingSongTime(this.songTime(), performance.now(), inputLatencyMs, pendingFrameMs, WORKER_LIMITS.frameMs));
    // End with the sound itself. The song clock includes the picture offset and can run
    // ahead of the sound, which would cut the ending short.
    if (this.audio?.ended) this.finish();
  }

  private updateDebug(): void {
    this.ui.debug.hidden = !this.debugVisible;
    if (!this.debugVisible) return;
    const { settings } = this.options;
    const hands = this.frame?.players.map((player) => player.hands.length).join(' / ') ?? '0 / 0';
    this.ui.debug.textContent = [
      `FPS ${this.fps.toFixed(0)} · inference ${this.frame?.inferenceMs.toFixed(1) ?? '—'} ms`,
      this.trackerDebugLine(),
      `Hands ${hands}`,
      ...this.faceDebugLines(),
      `Input ${settings.inputLatencyMs} ms · AV ${settings.avOffsetMs} ms`,
      `Song ${this.songTime().toFixed(3)} s`,
    ].join('\n');
  }

  private trackerDebugLine(): string {
    const { input } = this.inputs;
    const where = input?.thread ? ` · ${input.thread} thread` : '';
    const line = `${input?.mode ?? this.inputs.trackerMode()} · ${input?.delegate ?? '—'}${where}`;
    return input?.faceDelegate ? `${line} · faces ${input.faceDelegate}` : line;
  }

  /**
   * One line for each player with faces on: the strength of each expression in the latest
   * frame. The tracker reads a face only around a face cue, so the line shows a dash
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

  /** Width over height of the camera picture. Test inputs have no camera and use 16:9. */
  private videoAspect(): number {
    const video = this.inputs.input?.video;
    return video && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 16 / 9;
  }

  /** The timing of the calibration, from who began it. Test inputs need no time to walk back. */
  private fitPlan(): FitPlan {
    return planFit(this.fitBegunByHand, this.options.input === 'camera');
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
   * the game needs that player's face for a face cue. At all other times the face models
   * do no work, so hand tracking keeps its full speed.
   */
  private faceRegions(): FaceRegions {
    const regions: FaceRegions = [null, null];
    if (this.phase !== 'play') return regions;
    const timeSec = this.songTime();
    const inputLatencySec = this.options.settings.inputLatencyMs / 1000;
    for (const player of this.players) {
      const faceNeeded = needsFace(player.faceCues, player.level, timeSec, inputLatencySec);
      if (faceNeeded) regions[player.index] = faceRegion(player.grid);
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
    const { preview } = this;
    window.__dance = {
      phase: this.phase,
      songTime: this.songTime(),
      report: this.report,
      frameLog: this.options.frameLog ? this.frameLog : undefined,
      // Read on demand: the preview changes between the moments this state is written.
      get preview() {
        return preview.state;
      },
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
    // The player closes first: it hears no more of a video that goes, and of a preview that ends.
    this.ui.player.close();
    this.inputs.dispose();
    this.audio?.close();
    this.preview.dispose();
    this.recordings.dispose();
    window.removeEventListener('keydown', this.onKey);
  }
}
