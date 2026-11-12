import { startCamera } from '../tracking/camera';
import type { ZoneFrame, ZoneTracker } from '../tracking/zones';
import { PHASES, QUICK_TIMING, TIMING, VARIANTS } from './config';
import type { PageOptions, Timing, Variant } from './config';
import { PHASE_BEEP_HZ, RECORD_BEEP_HZ, SoundCues } from './cues';
import { LiveView } from './liveView';
import { buildReport } from './report';
import type { CameraInfo, ZoneTestReport } from './report';
import { resultsHtml } from './results';
import { runSteps, TestRun } from './run';
import type { Step } from './run';
import { TestScreen } from './screen';
import type { Cue } from './screen';
import { mean } from './statistics';
import { keepReport, keptReport, resendKeptReport, sendReport } from './storage';
import { TrackerSet } from './trackerSet';

/**
 * What the page is doing:
 * starting → live → preparing (the trackers load) → running → results, and back to live.
 */
type Mode = 'starting' | 'live' | 'preparing' | 'running' | 'results' | 'failed';

/** Live state for automated checks, at `window.__zoneTest`. */
interface PublicState {
  mode: Mode;
  zones: number;
  layout: string;
  model: string;
  /** `GPU` or `CPU`, or `loading` while the tracker of the chosen variant loads. */
  delegate: string;
  /** Frames tracked since the tracker in use took over. */
  frames: number;
  framesPerSec: number;
  inferenceMs: number | null;
  handsPerZone: number[];
  status: string;
  /** Where the dev server wrote the last report. */
  savedPath?: string;
  report?: ZoneTestReport;
}
declare global {
  interface Window {
    __zoneTest: PublicState;
  }
}

/** The live numbers on screen are means over this long. */
const LIVE_WINDOW_MS = 2000;
/** The line of numbers changes this often. Faster is hard to read. */
const HUD_INTERVAL_MS = 250;

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** A length of time in words, for example `2 min 30 s`. */
function lengthText(ms: number): string {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes} min ${seconds % 60} s` : `${seconds} s`;
}

function standHint(zones: number): string {
  const people = zones === 1 ? '1 person fits' : `${zones} people fit side by side`;
  return `Stand where ${people}. Stay inside one zone, also with your arms out wide.`;
}

/**
 * The zone test: a live view of the zone tracker, and a hands-free run that measures every
 * variant of it and saves the numbers.
 */
export class ZoneTestPage {
  private readonly screen: TestScreen;
  private readonly view: LiveView;
  private readonly sound: SoundCues;
  private readonly quick: boolean;
  private readonly timing: Timing;

  private mode: Mode = 'starting';
  private zones: number;
  /** The variant on screen, as an index into VARIANTS. */
  private variantIndex = 0;
  private trackers: TrackerSet;
  /** The tracker that reads every camera frame now. Unset while the chosen variant loads. */
  private tracker?: ZoneTracker;
  /** Goes up with every choice of a variant, so a tracker that loads late knows it is stale. */
  private choice = 0;

  private video?: HTMLVideoElement;
  private camera: CameraInfo = { width: 0, height: 0, frameRate: null };
  private frame?: ZoneFrame;
  /** The frames of the last two seconds, for the live numbers. */
  private recentFrames: ZoneFrame[] = [];
  private framesTracked = 0;
  private hudShownMs = 0;

  private run?: TestRun;
  /** The loaded tracker of every variant, for the run. */
  private runTrackers: ZoneTracker[] = [];
  private wakeLock?: WakeLockSentinel;

  private status = '';
  private reportJson: string | null = keptReport();
  private report?: ZoneTestReport;
  private savedPath?: string;
  private disposed = false;

  constructor(root: HTMLElement, options: PageOptions) {
    this.screen = new TestScreen(root);
    this.view = new LiveView(this.screen.canvas);
    this.sound = new SoundCues(options.silent);
    this.quick = options.quick;
    this.timing = options.quick ? QUICK_TIMING : TIMING;
    this.zones = options.zones;
    this.trackers = new TrackerSet(options.zones);

    this.screen.copyButton.disabled = this.reportJson === null;
    this.screen.startButton.addEventListener('click', () => void this.startTest());
    this.screen.fullscreenButton.addEventListener('click', () => void this.toggleFullscreen());
    this.screen.copyButton.addEventListener('click', () => void this.copyReport());
    this.screen.backButton.addEventListener('click', () => this.setMode('live'));
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('pagehide', () => this.dispose(), { once: true });
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    Object.defineProperty(window, '__zoneTest', { get: () => this.publicState(), configurable: true });

    this.screen.showBrief('Allow the camera.');
    void this.resendEarlierReport();
    void this.start();
  }

  // --- Start and stop ---

  private async start(): Promise<void> {
    let video: HTMLVideoElement;
    try {
      video = await startCamera();
    } catch (error) {
      this.fail(`The camera did not start: ${errorText(error)}. Allow the camera in Chrome, then reload.`);
      return;
    }
    this.video = video;
    if (this.disposed) {
      this.stopCamera();
      return;
    }

    const [track] = (video.srcObject as MediaStream).getVideoTracks();
    this.camera = {
      width: video.videoWidth,
      height: video.videoHeight,
      frameRate: track.getSettings().frameRate ?? null,
    };
    this.screen.showVideo(video);
    this.setMode('live');
    void this.showVariant();
    video.requestVideoFrameCallback(this.onVideoFrame);
    requestAnimationFrame(this.render);
  }

  private fail(message: string): void {
    this.run = undefined;
    this.tracker = undefined;
    this.letScreenSleep();
    this.setMode('failed');
    this.screen.showBrief(message);
    console.error(message);
  }

  private dispose(): void {
    this.disposed = true;
    this.stopCamera();
    this.trackers.dispose();
    this.sound.close();
    this.letScreenSleep();
  }

  private stopCamera(): void {
    const stream = this.video?.srcObject;
    if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    document.body.dataset.mode = mode; // The stylesheet lays the page out by mode.
    this.screen.startButton.disabled = mode !== 'live';
    if (mode === 'results') return;

    this.screen.showCamera();
    if (mode === 'live') {
      const length = lengthText(runSteps(this.timing).reduce((sum, step) => sum + step.durationMs, 0));
      this.screen.showBrief(
        standHint(this.zones),
        `Press B, then walk back. The test takes ${length} and tells you what to do.`,
      );
    }
  }

  /** For a check after an await: the mode can have changed while the page waited. */
  private isIn(mode: Mode): boolean {
    return this.mode === mode;
  }

  private setStatus(status: string): void {
    this.status = status;
    this.screen.setStatus(status);
  }

  // --- The variant on screen ---

  private chooseZones(zones: number): void {
    if (this.mode !== 'live' || zones === this.zones) return;
    this.trackers.dispose();
    this.trackers = new TrackerSet(zones);
    this.zones = zones;
    this.setMode('live'); // The hint on screen names the number of zones.
    void this.showVariant();
  }

  /** Moves to the variant that differs from the one on screen in the layout only, or in the model only. */
  private switchVariant(change: keyof Variant): void {
    if (this.mode !== 'live') return;
    const keep: keyof Variant = change === 'layout' ? 'model' : 'layout';
    const current = VARIANTS[this.variantIndex];
    this.variantIndex = VARIANTS.findIndex(
      (variant) => variant[keep] === current[keep] && variant[change] !== current[change],
    );
    void this.showVariant();
  }

  /**
   * Lets the chosen variant track, and loads it first when it is new.
   * When several choices load at once, the last one wins.
   */
  private async showVariant(): Promise<void> {
    const choice = ++this.choice;
    this.tracker = undefined;
    try {
      const tracker = await this.trackers.load(this.variantIndex);
      if (choice === this.choice) this.useTracker(tracker);
    } catch (error) {
      if (choice === this.choice) this.setStatus(`The tracker did not load: ${errorText(error)}`);
    }
  }

  private useTracker(tracker: ZoneTracker): void {
    this.tracker = tracker;
    this.frame = undefined;
    this.recentFrames = [];
    this.framesTracked = 0;
  }

  // --- The run ---

  private async startTest(): Promise<void> {
    if (this.mode !== 'live') return;
    this.setMode('preparing');
    this.sound.unlock(); // Now, inside the click or key press that started the test.
    this.choice++; // A variant that still loads for the live view must not take over.

    try {
      this.runTrackers = await this.loadEveryVariant();
    } catch (error) {
      if (!this.isIn('preparing')) return;
      this.setMode('live');
      this.setStatus(`The test could not start: ${errorText(error)}`);
      void this.showVariant();
      return;
    }
    if (!this.isIn('preparing')) return;

    await this.keepScreenOn();
    this.setStatus('');
    this.savedPath = undefined; // The path of an earlier report says nothing about this run.
    this.run = new TestRun(this.zones, this.timing, performance.now());
    this.setMode('running');
    const seconds = Math.round(this.timing.countdownMs / 1000);
    this.sound.say(`The test starts in ${seconds} seconds. Walk back and stand in one zone.`);
  }

  /** Loads the tracker of every variant, so no model loads in the middle of the run. */
  private async loadEveryVariant(): Promise<ZoneTracker[]> {
    const trackers: ZoneTracker[] = [];
    for (let index = 0; index < VARIANTS.length; index++) {
      this.screen.showBrief(
        `Loading tracker ${index + 1} of ${VARIANTS.length}. The countdown starts when all are ready.`,
      );
      trackers.push(await this.trackers.load(index));
    }
    return trackers;
  }

  /** Moves the run on when a step is over. Called for every camera frame and every screen frame. */
  private advanceRun(nowMs: number): void {
    const run = this.run;
    if (!run || !run.advance(nowMs)) return;

    const step = run.step;
    if (step) this.enterStep(step);
    else void this.finishRun(run);
  }

  private enterStep(step: Step): void {
    if (step.kind === 'record') {
      this.sound.beep(RECORD_BEEP_HZ);
      return;
    }
    // A phase begins with its get-ready step. The tracker of its variant takes over here,
    // so its slow first frames are over before the recording starts.
    this.variantIndex = step.variant;
    if (this.tracker !== this.runTrackers[step.variant]) this.useTracker(this.runTrackers[step.variant]);
    this.sound.beep(PHASE_BEEP_HZ);
    const round = step.phase === 0 ? `Round ${step.variant + 1} of ${VARIANTS.length}. ` : '';
    this.sound.say(round + PHASES[step.phase].instruction.toLowerCase());
  }

  private async finishRun(run: TestRun): Promise<void> {
    this.run = undefined;
    this.letScreenSleep();
    this.sound.say('The test is done.');

    const report = buildReport({
      zones: this.zones,
      quick: this.quick,
      timing: this.timing,
      camera: this.camera,
      userAgent: navigator.userAgent,
      savedAt: new Date(),
      trackers: this.runTrackers,
      summaries: run.summaries,
    });
    this.report = report;
    this.screen.showResults(resultsHtml(report));
    this.setMode('results');
    await this.saveReport(JSON.stringify(report, null, 2));
  }

  private stopRun(reason: string): void {
    this.run = undefined;
    this.letScreenSleep();
    this.sound.hush();
    this.setMode('live');
    this.setStatus(reason);
  }

  private cueFor(run: TestRun, step: Step, nowMs: number): Cue {
    const timeLeft = { secondsLeft: run.secondsLeft(nowMs), progress: run.progress(nowMs) };
    if (step.kind === 'countdown') {
      return {
        ...timeLeft,
        title: `${this.zones} zones · ${VARIANTS.length} rounds`,
        instruction: 'WALK BACK · STAND IN ONE ZONE',
        word: 'STARTS IN',
        next: `First: ${PHASES[0].instruction}`,
        recording: false,
      };
    }

    const variant = VARIANTS[step.variant];
    const recording = step.kind === 'record';
    const upcoming = run.upcoming;
    return {
      ...timeLeft,
      title: `Round ${step.variant + 1} of ${VARIANTS.length} · ${variant.layout} · ${variant.model}`,
      instruction: PHASES[step.phase].instruction,
      word: recording ? 'RECORDING' : 'GET READY',
      next: recording && upcoming ? `Next: ${PHASES[upcoming.phase].instruction}` : '',
      recording,
    };
  }

  // --- The report ---

  private async saveReport(json: string): Promise<void> {
    this.reportJson = json;
    this.screen.copyButton.disabled = false;
    const kept = keepReport(json);
    this.setStatus('Saving the report…');
    try {
      this.savedPath = await sendReport(json);
      this.setStatus(`Saved: ${this.savedPath}`);
    } catch (error) {
      const spare = kept
        ? 'It is kept in this browser and is sent again when this page loads.'
        : 'This browser could not keep it either.';
      this.setStatus(`The report is not on disk: ${errorText(error)} ${spare} Copy JSON copies it now.`);
    }
  }

  /** A report that never reached the dev server is sent again when the page loads. */
  private async resendEarlierReport(): Promise<void> {
    try {
      const path = await resendKeptReport();
      if (path !== null) this.setStatus(`An earlier report is now saved: ${path}`);
    } catch (error) {
      this.setStatus(`An earlier report is still only in this browser: ${errorText(error)} Copy JSON copies it.`);
    }
  }

  private async copyReport(): Promise<void> {
    if (this.reportJson === null) return;
    try {
      await navigator.clipboard.writeText(this.reportJson);
      this.setStatus('JSON copied.');
    } catch (error) {
      this.setStatus(`Copy failed: ${errorText(error)}`);
    }
  }

  // --- Every frame ---

  /** Chrome calls this once for each new camera frame. */
  private readonly onVideoFrame = (): void => {
    if (this.disposed || !this.video) return;
    const nowMs = performance.now();
    this.advanceRun(nowMs);
    this.trackFrame(this.video, nowMs);
    this.video.requestVideoFrameCallback(this.onVideoFrame);
  };

  private trackFrame(video: HTMLVideoElement, nowMs: number): void {
    const tracker = this.tracker;
    const isTracking = this.mode === 'live' || this.mode === 'preparing' || this.mode === 'running';
    if (!tracker || !isTracking) return;

    let frame: ZoneFrame;
    try {
      frame = tracker.process(video, nowMs);
    } catch (error) {
      this.fail(`Tracking stopped: ${errorText(error)}. Reload the page to try again.`);
      return;
    }
    this.frame = frame;
    this.framesTracked++;
    this.recentFrames.push(frame);
    this.recentFrames = this.recentFrames.filter((recent) => recent.timeMs >= nowMs - LIVE_WINDOW_MS);
    this.run?.record(frame);
  }

  /** Draws one screen frame. */
  private readonly render = (): void => {
    if (this.disposed) return;
    const nowMs = performance.now();
    this.advanceRun(nowMs);

    const step = this.run?.step;
    if (this.run && step) this.screen.showCue(this.cueFor(this.run, step, nowMs));
    if (nowMs - this.hudShownMs >= HUD_INTERVAL_MS) {
      this.hudShownMs = nowMs;
      this.screen.setHud(this.hudLine());
    }
    if (this.video && this.mode !== 'results') {
      this.view.draw(this.zones, this.frame, this.video.videoWidth / this.video.videoHeight);
    }
    requestAnimationFrame(this.render);
  };

  private liveNumbers(): { framesPerSec: number; inferenceMs: number | null } {
    const frames = this.recentFrames;
    const spanMs = frames.length > 1 ? frames[frames.length - 1].timeMs - frames[0].timeMs : 0;
    return {
      framesPerSec: spanMs > 0 ? ((frames.length - 1) * 1000) / spanMs : 0,
      inferenceMs: mean(frames.map((frame) => frame.inferenceMs)),
    };
  }

  private handsPerZone(): number[] {
    return Array.from({ length: this.zones }, (_, zone) => this.frame?.zones[zone]?.length ?? 0);
  }

  /** The line of facts at the top of the camera view. */
  private hudLine(): string {
    const { layout, model } = VARIANTS[this.variantIndex];
    const variant = `${this.zones} zones · ${layout} · ${model}`;
    if (!this.tracker) return `${variant} · loading…`;

    const { framesPerSec, inferenceMs } = this.liveNumbers();
    return [
      variant,
      this.tracker.delegate,
      `${this.camera.width}×${this.camera.height}`,
      `${framesPerSec.toFixed(1)} fps`,
      `${inferenceMs?.toFixed(1) ?? '—'} ms`,
      `hands ${this.handsPerZone().join(' | ')}`,
    ].join(' · ');
  }

  private publicState(): PublicState {
    const { layout, model } = VARIANTS[this.variantIndex];
    return {
      mode: this.mode,
      zones: this.zones,
      layout,
      model,
      delegate: this.tracker?.delegate ?? 'loading',
      frames: this.framesTracked,
      ...this.liveNumbers(),
      handsPerZone: this.handsPerZone(),
      status: this.status,
      savedPath: this.savedPath,
      report: this.report,
    };
  }

  // --- Keys, fullscreen, screen lock ---

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === '3' || key === '4') this.chooseZones(Number(key));
    else if (key === 'l') this.switchVariant('layout');
    else if (key === 'm') this.switchVariant('model');
    else if (key === 'b') void this.startTest();
    else if (key === 'f') void this.toggleFullscreen();
    else if (key === 'escape' && this.run) this.stopRun('The test was stopped. Press B to start again.');
    else return;
    event.preventDefault();
  };

  /** A hidden page gets no camera frames, so a run cannot go on. */
  private readonly onVisibilityChange = (): void => {
    if (document.hidden && this.run) {
      this.stopRun('The test stopped because the page was hidden. Press B to start again.');
    }
  };

  private async toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (error) {
      this.setStatus(`Fullscreen failed: ${errorText(error)}`);
    }
  }

  /** Nobody touches the laptop during a run, so the screen must not go dark. */
  private async keepScreenOn(): Promise<void> {
    if (!('wakeLock' in navigator)) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      // The run still works. The screen may dim.
    }
  }

  private letScreenSleep(): void {
    void this.wakeLock?.release().catch(() => {});
    this.wakeLock = undefined;
  }
}
