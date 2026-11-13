import { find } from './dom';
import { mainVideo, sizeText, VIDEO_NAMES } from './recording';
import type { RoundVideos, VideoKind } from './recording';

/**
 * The buttons sit at the top, in from the sides, where the camera tracks a hand well.
 * The browser's own video controls keep only play, the time line and the volume. Their full
 * screen would show the video without these buttons, and their Esc would not close the player;
 * their download would be a second way to do what the Download button does.
 */
const PLAYER_HTML = `
  <video playsinline controls disablepictureinpicture
    controlslist="nofullscreen nodownload noremoteplayback noplaybackrate"></video>
  <div class="player-bar">
    <button type="button" id="player-game" data-hand="player-game">🎮 ${VIDEO_NAMES.game}</button>
    <button type="button" id="player-camera" data-hand="player-camera">🎥 ${VIDEO_NAMES.camera}</button>
    <a id="player-download" data-hand="player-download"></a>
    <button type="button" id="player-close" data-hand="player-close">✕ Close · Esc</button>
  </div>`;

/** What the open player shows. */
interface Showing {
  round: RoundVideos;
  kind: VideoKind;
  /** This player switched the page to full screen, so closing it leaves full screen too. */
  ownsFullscreen: boolean;
}

/**
 * The video player: it fills the window and plays a recorded round with its sound.
 * While it is open, it is the whole page for the keyboard: everything behind it is inert,
 * so Tab and Enter reach only the player.
 */
export class VideoPlayer {
  private readonly element: HTMLElement;
  private readonly video: HTMLVideoElement;
  /** What the player shows now. Unset while it is closed. */
  private playing?: Showing;
  /** The element that had the focus before the player opened. It gets the focus back on close. */
  private returnFocus?: HTMLElement;
  /** The elements behind the player that it made inert. */
  private madeInert: HTMLElement[] = [];
  /** Hears which round the player shows when it opens, and nothing when it closes. */
  onChange?: (shown: RoundVideos | undefined) => void;

  /** Builds the player in `element`, which stays hidden while the player is closed. */
  constructor(element: HTMLElement) {
    element.innerHTML = PLAYER_HTML;
    // The player itself takes the focus when it opens, so a key acts on nothing behind it.
    element.tabIndex = -1;
    this.element = element;
    this.video = find(element, 'video');
    find(element, '#player-game').addEventListener('click', () => this.show('game'));
    find(element, '#player-camera').addEventListener('click', () => this.show('camera'));
    find(element, '#player-close').addEventListener('click', () => this.close());
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
  }

  get isOpen(): boolean {
    return this.playing !== undefined;
  }

  /** True when `target` is one of the player's own buttons or links. A key there acts on it. */
  isOwnControl(target: EventTarget | null): boolean {
    return target instanceof Element && this.element.contains(target) && target.matches('button, a');
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
    const first = mainVideo(round);
    if (!first) return;
    const playing: Showing = { round, kind: first.kind, ownsFullscreen: !byHand && !document.fullscreenElement };
    this.playing = playing;
    if (playing.ownsFullscreen) this.enterFullscreen(playing);
    this.element.hidden = false;
    this.holdFocus();
    this.playFrom(0);
    this.onChange?.(round);
  }

  close(): void {
    const playing = this.playing;
    if (!playing) return;
    this.playing = undefined;
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.element.hidden = true;
    this.releaseFocus();
    if (playing.ownsFullscreen && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    this.onChange?.(undefined);
  }

  /** Space in the player: pause, or play on. */
  togglePause(): void {
    if (!this.playing) return;
    if (this.video.paused) void this.video.play().catch(() => {});
    else this.video.pause();
  }

  /**
   * Switches the whole page to full screen, not the player alone, so the hand rings still show.
   * The switch takes a moment. A player that closed meanwhile wants no full screen any more.
   */
  private enterFullscreen(playing: Showing): void {
    document.documentElement.requestFullscreen().then(
      () => {
        if (this.playing !== playing) void document.exitFullscreen().catch(() => {});
      },
      () => {},
    );
  }

  /** Makes everything behind the player inert, and moves the focus into the player. */
  private holdFocus(): void {
    const focused = document.activeElement;
    this.returnFocus = focused instanceof HTMLElement && focused !== document.body ? focused : undefined;
    const behind = [...(this.element.parentElement?.children ?? [])].filter(
      (sibling): sibling is HTMLElement => sibling !== this.element && sibling instanceof HTMLElement && !sibling.inert,
    );
    for (const element of behind) element.inert = true;
    this.madeInert = behind;
    this.element.focus({ preventScroll: true });
  }

  /** Undoes `holdFocus`: the page behind works again, and the focus goes back where it was. */
  private releaseFocus(): void {
    for (const element of this.madeInert) element.inert = false;
    this.madeInert = [];
    // The element may have gone meanwhile, for example a list of rounds that was drawn again.
    if (this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
    this.returnFocus = undefined;
  }

  /**
   * In full screen, Chrome keeps the first Esc for itself and only leaves full screen. The
   * player closes whenever full screen ends, so one Esc does both: also when the page was in
   * full screen before the player opened.
   */
  private onFullscreenChange = (): void => {
    if (this.playing && !document.fullscreenElement) this.close();
  };

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
