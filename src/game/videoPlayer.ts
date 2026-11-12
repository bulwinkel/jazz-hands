import { find } from './dom';
import { sizeText } from './recording';
import type { RoundVideos, VideoKind } from './recording';

/** The buttons sit at the top, in from the sides, where the camera tracks a hand well. */
const PLAYER_HTML = `
  <video playsinline controls></video>
  <div class="player-bar">
    <button type="button" id="player-game" data-hand="player-game">🎮 Game view</button>
    <button type="button" id="player-camera" data-hand="player-camera">🎥 Camera only</button>
    <a id="player-download" data-hand="player-download"></a>
    <button type="button" id="player-close" data-hand="player-close">✕ Close · Esc</button>
  </div>`;

/** The video player: it fills the window and plays a recorded round with its sound. */
export class VideoPlayer {
  private readonly element: HTMLElement;
  private readonly video: HTMLVideoElement;
  /** What the player shows now. Unset while it is closed. */
  private playing?: { round: RoundVideos; kind: VideoKind; ownsFullscreen: boolean };
  /** Hears when the player opens and when it closes. */
  onChange?: (isOpen: boolean) => void;

  /** Builds the player in `element`, which stays hidden while the player is closed. */
  constructor(element: HTMLElement) {
    element.innerHTML = PLAYER_HTML;
    this.element = element;
    this.video = find(element, 'video');
    find(element, '#player-game').addEventListener('click', () => this.show('game'));
    find(element, '#player-camera').addEventListener('click', () => this.show('camera'));
    find(element, '#player-close').addEventListener('click', () => this.close());
  }

  get isOpen(): boolean {
    return this.playing !== undefined;
  }

  /** The items a hand can choose in the player: its buttons on show. */
  handElements(): HTMLElement[] {
    return [...this.element.querySelectorAll<HTMLElement>('[data-hand]')].filter((element) => !element.hidden);
  }

  /**
   * Plays a recorded round with its sound, in a player that fills the window.
   * A real click also switches the browser to full screen. A choice by hand cannot: a browser
   * goes to full screen only on a click or a key press.
   */
  open(round: RoundVideos, byHand: boolean): void {
    const first = round.videos.find((video) => video.kind === 'game') ?? round.videos[0];
    if (!first) return;
    const ownsFullscreen = !byHand && !document.fullscreenElement;
    // The whole page goes to full screen, not the player alone, so the hand rings still show.
    if (ownsFullscreen) void document.documentElement.requestFullscreen().catch(() => {});
    this.playing = { round, kind: first.kind, ownsFullscreen };
    this.element.hidden = false;
    this.playFrom(0);
    this.onChange?.(true);
  }

  close(): void {
    const playing = this.playing;
    if (!playing) return;
    this.playing = undefined;
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.element.hidden = true;
    if (playing.ownsFullscreen && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    this.onChange?.(false);
  }

  /** Space in the player: pause, or play on. */
  togglePause(): void {
    if (!this.playing) return;
    if (this.video.paused) void this.video.play().catch(() => {});
    else this.video.pause();
  }

  /** Switches between the game view and the camera view, at the same moment of the round. */
  private show(kind: VideoKind): void {
    const playing = this.playing;
    if (!playing || playing.kind === kind || !playing.round.videos.some((video) => video.kind === kind)) return;
    playing.kind = kind;
    this.playFrom(this.video.currentTime);
  }

  /** Loads the chosen video of the round and plays it from `fromSec`. */
  private playFrom(fromSec: number): void {
    const playing = this.playing;
    const video = playing?.round.videos.find((candidate) => candidate.kind === playing.kind);
    if (!playing || !video) return;

    this.video.src = video.url;
    this.video.muted = false;
    // Before the video has loaded, this sets where it will start.
    this.video.currentTime = fromSec;
    void this.video.play().catch(() => {});

    for (const kind of ['game', 'camera'] as const) {
      const button = find<HTMLButtonElement>(this.element, `#player-${kind}`);
      button.hidden = !playing.round.videos.some((candidate) => candidate.kind === kind);
      button.setAttribute('aria-pressed', String(kind === playing.kind));
    }
    const download = find<HTMLAnchorElement>(this.element, '#player-download');
    download.href = video.url;
    download.download = video.fileName;
    download.textContent = `⬇ Download · ${sizeText(video.sizeBytes)}`;
  }
}
