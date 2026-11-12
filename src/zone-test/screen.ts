/** The page of the zone test: the camera view with its texts, and the results screen. */

const SHELL_HTML = `
  <main id="stage" aria-label="Mirrored camera with one zone for each player">
    <canvas aria-hidden="true"></canvas>
    <div id="hud" role="status" aria-live="off">Starting the camera…</div>
    <section id="brief">
      <p id="brief-text"></p>
      <p id="brief-steps"></p>
      <div id="brief-buttons">
        <button id="start" class="primary" disabled>Start the test · B</button>
        <button id="fullscreen">Fullscreen · F</button>
      </div>
      <p id="keys">3 or 4 zones · L layout · M model · B start · Esc stop · F fullscreen</p>
    </section>
    <section id="cue" hidden aria-label="What to do now">
      <div id="cue-title"></div>
      <div id="cue-instruction"></div>
      <div id="cue-stage"><span id="cue-word"></span><span id="cue-seconds"></span></div>
      <div id="cue-next"></div>
      <progress max="1" value="0" aria-label="How far the test has come"></progress>
    </section>
  </main>
  <section id="results" hidden aria-label="Test results"></section>
  <footer>
    <span id="status" role="status" aria-live="polite"></span>
    <div id="footer-buttons">
      <button id="back" hidden>Back to camera</button>
      <button id="copy" disabled>Copy JSON</button>
    </div>
  </footer>`;

/** What the large text says during a run. */
export interface Cue {
  /** Which round and which tracker, in small text. */
  title: string;
  /** What the person does now, in very large text. */
  instruction: string;
  /** What the countdown counts down to: the start, the recording, or its end. */
  word: string;
  secondsLeft: number;
  /** What comes after this, so the person can get ready for it. Empty when nothing does. */
  next: string;
  recording: boolean;
  /** How far the run has come, 0..1. */
  progress: number;
}

function find<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

export class TestScreen {
  readonly canvas: HTMLCanvasElement;
  readonly startButton: HTMLButtonElement;
  readonly fullscreenButton: HTMLButtonElement;
  readonly copyButton: HTMLButtonElement;
  readonly backButton: HTMLButtonElement;

  private readonly stage: HTMLElement;
  private readonly hud: HTMLElement;
  private readonly brief: HTMLElement;
  private readonly briefText: HTMLElement;
  private readonly briefSteps: HTMLElement;
  private readonly cue: HTMLElement;
  private readonly results: HTMLElement;
  private readonly status: HTMLElement;

  constructor(root: HTMLElement) {
    root.innerHTML = SHELL_HTML;
    this.canvas = find(root, 'canvas');
    this.startButton = find(root, '#start');
    this.fullscreenButton = find(root, '#fullscreen');
    this.copyButton = find(root, '#copy');
    this.backButton = find(root, '#back');
    this.stage = find(root, '#stage');
    this.hud = find(root, '#hud');
    this.brief = find(root, '#brief');
    this.briefText = find(root, '#brief-text');
    this.briefSteps = find(root, '#brief-steps');
    this.cue = find(root, '#cue');
    this.results = find(root, '#results');
    this.status = find(root, '#status');
  }

  /** Puts the camera picture behind everything else on the stage. */
  showVideo(video: HTMLVideoElement): void {
    video.setAttribute('aria-label', 'Mirrored camera');
    this.stage.prepend(video);
  }

  /** The line of facts about the tracker at the top of the camera view. */
  setHud(text: string): void {
    this.hud.textContent = text;
  }

  /** The line at the bottom of the page: what is loading, what failed, where the report went. */
  setStatus(text: string): void {
    this.status.textContent = text;
  }

  /**
   * Outside a run: what the person is to do in large text, a smaller line on how to go on,
   * and the start button.
   */
  showBrief(text: string, steps = ''): void {
    this.briefText.textContent = text;
    this.briefSteps.textContent = steps;
    this.brief.hidden = false;
    this.cue.hidden = true;
  }

  /** During a run: the instruction of the moment in very large text. */
  showCue(cue: Cue): void {
    this.brief.hidden = true;
    this.cue.hidden = false;
    this.cue.classList.toggle('recording', cue.recording);
    find(this.cue, '#cue-title').textContent = cue.title;
    find(this.cue, '#cue-instruction').textContent = cue.instruction;
    find(this.cue, '#cue-word').textContent = cue.word;
    find(this.cue, '#cue-seconds').textContent = String(cue.secondsLeft);
    find(this.cue, '#cue-next').textContent = cue.next;
    find<HTMLProgressElement>(this.cue, 'progress').value = cue.progress;
  }

  showResults(html: string): void {
    this.results.innerHTML = html;
    this.results.hidden = false;
    this.backButton.hidden = false;
    this.stage.hidden = true;
  }

  showCamera(): void {
    this.results.hidden = true;
    this.backButton.hidden = true;
    this.stage.hidden = false;
  }
}
