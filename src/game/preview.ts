import { PREVIEW, SONGS } from './config';
import { fetchManifest, previewStartSec } from './manifest';
import type { Manifest } from './types';

/** How often the volume is set while a preview plays. Short enough for a smooth fade. */
const TICK_MS = 40;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** What a preview does right now. Automated checks read it at `window.__dance.preview`. */
export interface PreviewState {
  /** The audio file of the preview, or null when no preview is on. */
  url: string | null;
  playing: boolean;
  /** Position in the song, in seconds. */
  timeSec: number;
  volume: number;
}

/**
 * Plays one part of a song in the menu, so players hear a song before they choose it.
 * The part plays again and again, with a fade at both ends.
 *
 * It uses an audio element and not the game's audio context. The element plays the file as
 * it arrives, with no wait to decode the whole song, and a preview needs no exact timing.
 */
export class SongPreview {
  private readonly audio = new Audio();
  private url: string | null = null;
  private startSec = 0;
  private timer = 0;
  /** While the preview fades out to stop: when the fade began, and from which volume. */
  private stopping: { sinceMs: number; fromVolume: number } | null = null;
  /** Ends the wait for a click or a key press, when the browser has blocked the sound. */
  private gestureWait?: AbortController;

  get state(): PreviewState {
    const { audio } = this;
    const playing = this.url !== null && !audio.paused;
    return { url: this.url, playing, timeSec: audio.currentTime, volume: audio.volume };
  }

  /** Plays the part of the song that starts at `startSec`. A preview that plays now stops at once. */
  start(url: string, startSec: number): void {
    this.halt();
    this.url = url;
    this.startSec = startSec;

    const { audio } = this;
    audio.src = url;
    // Before the file has loaded, this sets where the sound will start.
    audio.currentTime = startSec;
    audio.volume = 0;
    this.timer = window.setInterval(this.shapeVolume, TICK_MS);
    this.play();
  }

  /** Fades the preview out, then stops it. */
  stop(): void {
    if (this.url === null || this.stopping) return;
    if (this.audio.paused) this.halt();
    else this.stopping = { sinceMs: performance.now(), fromVolume: this.audio.volume };
  }

  /** Stops the preview at once, with no fade. */
  halt(): void {
    window.clearInterval(this.timer);
    this.gestureWait?.abort();
    this.gestureWait = undefined;
    this.stopping = null;
    this.url = null;
    this.audio.pause();
  }

  private play(): void {
    const url = this.url;
    this.audio.play().catch((error: unknown) => {
      // A browser plays sound only on a page that was clicked or typed in at least once.
      // Any other failure means no preview: the round itself still reports a bad audio file.
      const blocked = error instanceof DOMException && error.name === 'NotAllowedError';
      if (blocked && this.url === url) this.playAfterGesture();
    });
  }

  /** Starts the blocked preview on the first click or key press. */
  private playAfterGesture(): void {
    this.gestureWait?.abort();
    const wait = new AbortController();
    this.gestureWait = wait;
    const retry = (): void => {
      wait.abort();
      this.audio.currentTime = this.startSec;
      this.play();
    };
    window.addEventListener('pointerdown', retry, { signal: wait.signal });
    window.addEventListener('keydown', retry, { signal: wait.signal });
  }

  /** Sets the volume for this moment: the fades at both ends of the part, and the fade to stop. */
  private shapeVolume = (): void => {
    const { audio } = this;
    if (this.stopping) {
      const left = 1 - (performance.now() - this.stopping.sinceMs) / (PREVIEW.stopFadeSec * 1000);
      if (left <= 0) this.halt();
      else audio.volume = this.stopping.fromVolume * left;
      return;
    }

    const playedSec = audio.currentTime - this.startSec;
    const leftSec = PREVIEW.lengthSec - playedSec;
    if (leftSec <= 0 || audio.ended) {
      // The part is over: play it again from its start.
      audio.volume = 0;
      audio.currentTime = this.startSec;
      if (audio.paused) this.play();
      return;
    }
    const fade = Math.min(playedSec / PREVIEW.fadeInSec, leftSec / PREVIEW.fadeOutSec);
    audio.volume = PREVIEW.volume * clamp01(fade);
  };
}

/**
 * The song preview of the menu. The game says which song to follow, or none. The preview then
 * plays the liveliest part of that song, and moves on when the song changes.
 */
export class MenuPreview {
  private readonly preview = new SongPreview();
  /** The song whose preview plays or is about to play, as an index into SONGS. */
  private song: number | null = null;
  private timer = 0;

  get state(): PreviewState {
    return this.preview.state;
  }

  /**
   * Plays a part of `song`. Null stops the preview: outside the menu, with previews off, or
   * while the video player is open. Call it after every change: it acts only when the song
   * is a new one, or when the preview goes on or off.
   */
  follow(song: number | null): void {
    if (song === null) {
      this.stop();
      return;
    }
    if (song === this.song) return;
    this.song = song;
    this.preview.stop();
    // Wait a moment: a player who steps through the songs hears only the one they stop on.
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.start(song), PREVIEW.waitSec * 1000);
  }

  /** Stops the preview at once, with no fade. For the end of the visit. */
  dispose(): void {
    window.clearTimeout(this.timer);
    this.preview.halt();
  }

  private async start(song: number): Promise<void> {
    let manifest: Manifest;
    try {
      manifest = await fetchManifest(SONGS[song].manifest);
    } catch {
      return; // No preview for a song whose data does not load. Starting the round reports the error.
    }
    // The player may have picked another song, or left the menu, while this loaded.
    if (this.song !== song) return;
    this.preview.start(manifest.audio, previewStartSec(manifest));
  }

  private stop(): void {
    window.clearTimeout(this.timer);
    this.song = null;
    this.preview.stop();
  }
}
