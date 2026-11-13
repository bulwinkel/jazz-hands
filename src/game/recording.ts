import { RECORDING } from './config';
import { clearScene, drawScene } from './recordingScene';
import type { RecordingScene } from './recordingScene';

/**
 * Records a round as video, when the players turn recording on in the menu.
 * Each round gives two videos:
 *
 * - the game view: the camera picture with the grids, the cues and the score, as on screen;
 * - the camera view: the camera picture alone, not mirrored, to share as a plain video.
 *
 * Both carry the song. The browser's MediaRecorder writes them while the round runs.
 * The values that tune a recording are in RECORDING, in config.ts.
 */

export type VideoKind = 'game' | 'camera';

export interface VideoFormat {
  mimeType: string;
  extension: string;
}

/** Best first. MP4 with H.264 and AAC opens on phones and in chat apps. WebM is the fallback. */
const FORMATS: readonly VideoFormat[] = [
  { mimeType: 'video/mp4;codecs=avc1.640028,mp4a.40.2', extension: 'mp4' },
  { mimeType: 'video/mp4', extension: 'mp4' },
  { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' },
  { mimeType: 'video/webm', extension: 'webm' },
];

/** The best format this browser can record, or null when it can record none. */
export function pickFormat(isSupported: (mimeType: string) => boolean): VideoFormat | null {
  return FORMATS.find((format) => isSupported(format.mimeType)) ?? null;
}

const twoDigits = (value: number): string => String(value).padStart(2, '0');

/**
 * For example `kitchen-disco-todo-bueno-2026-11-12-204107-game.mp4`, with the local date and
 * time. The seconds keep two rounds of one minute apart.
 */
export function videoFileName(songId: string, at: Date, kind: VideoKind, extension: string): string {
  const date = `${at.getFullYear()}-${twoDigits(at.getMonth() + 1)}-${twoDigits(at.getDate())}`;
  const time = `${twoDigits(at.getHours())}${twoDigits(at.getMinutes())}${twoDigits(at.getSeconds())}`;
  return `kitchen-disco-${songId}-${date}-${time}-${kind}.${extension}`;
}

/** A picture size of the given shape and about the given height. Video encoders need even numbers. */
export function videoSize(aspect: number, height: number): { width: number; height: number } {
  const even = (value: number): number => Math.max(2, Math.round(value / 2) * 2);
  return { width: even(height * aspect), height: even(height) };
}

/** A file size for people: megabytes with one decimal under 10 MB, whole megabytes above. */
export function sizeText(bytes: number): string {
  const megabytes = bytes / 1_000_000;
  return megabytes < 10 ? `${megabytes.toFixed(1)} MB` : `${Math.round(megabytes)} MB`;
}

/**
 * Paces the drawing of the game view to its video. The screen refreshes 60 times a second or
 * more, and a 720p frame takes time to draw, but the video takes only `frameRate` frames a
 * second. Returns the time the next frame is due when one is due at `nowMs`, else null.
 */
export function nextFrameDue(dueMs: number, nowMs: number, frameRate: number): number | null {
  if (nowMs + RECORDING.frameSlackMs < dueMs) return null;
  const frameMs = 1000 / frameRate;
  // After a long gap, such as a hidden tab, count on from now: no burst of frames to catch up.
  return dueMs + frameMs > nowMs ? dueMs + frameMs : nowMs + frameMs;
}

/** One finished video. */
export interface RecordedVideo {
  kind: VideoKind;
  blob: Blob;
  extension: string;
}

/** One video of a round, ready to download. */
export interface RoundVideo {
  kind: VideoKind;
  url: string;
  fileName: string;
  sizeBytes: number;
}

/** The videos of one round, ready to download. */
export interface RoundVideos {
  /** Names the round for as long as the game keeps it. A new round gets a new id. */
  id: number;
  /** For example "20:41 · Todo Bueno". */
  label: string;
  videos: RoundVideo[];
}

/** The name of each kind of video, as the page shows it. */
export const VIDEO_NAMES: Record<VideoKind, string> = { game: 'Game view', camera: 'Camera only' };

/** The video of a round to show first: the game view, else the first video there is. */
export function mainVideo(round: RoundVideos): RoundVideo | undefined {
  return round.videos.find((video) => video.kind === 'game') ?? round.videos[0];
}

interface Track {
  kind: VideoKind;
  recorder: MediaRecorder;
  chunks: Blob[];
  stopped: Promise<void>;
}

/** Records one round. Make a new one for each round. */
export class RoundRecorder {
  private readonly format: VideoFormat;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private tracks: Track[] = [];
  /** The video track of the game view's canvas. It ends with the recording. */
  private canvasTrack?: CanvasCaptureMediaStreamTrack;
  /** When the next frame of the game view is due, in `performance.now()` time. */
  private frameDueMs = 0;
  private ended = false;

  private constructor(format: VideoFormat) {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is unavailable.');
    this.format = format;
    this.ctx = ctx;
  }

  /** A recorder, or null when this browser cannot record video. */
  static create(): RoundRecorder | null {
    if (typeof MediaRecorder === 'undefined') return null;
    const format = pickFormat((mimeType) => MediaRecorder.isTypeSupported(mimeType));
    return format ? new RoundRecorder(format) : null;
  }

  /** True from `start` until `stop` or `discard`. */
  get active(): boolean {
    return this.tracks.length > 0 && !this.ended;
  }

  /**
   * Starts both videos. `video` is the camera picture: with none, as with a test input, only
   * the game view is recorded. Each video has its own copy of the song, because each needs
   * its own delay to line the sound up with its picture.
   */
  start(video: HTMLVideoElement | undefined, gameAudio: MediaStream, cameraAudio: MediaStream): void {
    const aspect = video?.videoWidth ? video.videoWidth / video.videoHeight : 16 / 9;
    const size = videoSize(aspect, RECORDING.gameHeight);
    this.canvas.width = size.width;
    this.canvas.height = size.height;
    clearScene(this.ctx);

    // The stream takes a frame only when asked, after each drawn frame (see `drawFrame`), so one
    // clock paces the video. A stream with a frame rate of its own takes a frame on its own ticks,
    // and two clocks of 30 Hz together drop frames.
    const canvasTrack = this.canvas.captureStream(0).getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    this.canvasTrack = canvasTrack;
    canvasTrack.requestFrame();
    this.record('game', [canvasTrack, ...gameAudio.getAudioTracks()], RECORDING.gameBitsPerSec);

    const cameraStream = video?.srcObject instanceof MediaStream ? video.srcObject : undefined;
    const cameraTrack = cameraStream?.getVideoTracks()[0];
    if (cameraTrack) {
      this.record('camera', [cameraTrack, ...cameraAudio.getAudioTracks()], RECORDING.cameraBitsPerSec);
    }
  }

  private record(kind: VideoKind, mediaTracks: MediaStreamTrack[], videoBitsPerSecond: number): void {
    const recorder = new MediaRecorder(new MediaStream(mediaTracks), {
      mimeType: this.format.mimeType,
      videoBitsPerSecond,
      audioBitsPerSecond: RECORDING.audioBitsPerSec,
    });
    const chunks: Blob[] = [];
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    const stopped = new Promise<void>((resolve) => {
      recorder.addEventListener('stop', () => resolve(), { once: true });
      // A recorder that fails stops by itself. Its video is then as long as it got.
      recorder.addEventListener('error', () => resolve(), { once: true });
    });
    // Hand over the video in pieces of one second, so a long round does not sit in the encoder.
    recorder.start(1000);
    this.tracks.push({ kind, recorder, chunks, stopped });
  }

  /**
   * Draws one frame of the game view, when the video's frame rate asks for one. Call it on
   * every display frame, after the game has drawn its own canvas.
   */
  drawFrame(scene: RecordingScene): void {
    if (!this.active) return;
    const nextDueMs = nextFrameDue(this.frameDueMs, performance.now(), RECORDING.frameRate);
    if (nextDueMs === null) return;
    this.frameDueMs = nextDueMs;
    drawScene(this.ctx, scene);
    this.canvasTrack?.requestFrame();
  }

  /** Holds both videos while the game is paused, so the pause is not in them. */
  pause(): void {
    for (const { recorder } of this.tracks) if (recorder.state === 'recording') recorder.pause();
  }

  resume(): void {
    for (const { recorder } of this.tracks) if (recorder.state === 'paused') recorder.resume();
  }

  /** Ends the recording and returns the finished videos. */
  async stop(): Promise<RecordedVideo[]> {
    const tracks = this.tracks;
    this.end();
    await Promise.all(tracks.map((track) => track.stopped));
    const type = this.format.mimeType.split(';')[0];
    return tracks
      .filter((track) => track.chunks.length > 0)
      .map((track) => ({ kind: track.kind, blob: new Blob(track.chunks, { type }), extension: this.format.extension }));
  }

  /** Ends the recording and throws the videos away. */
  discard(): void {
    this.end();
    this.tracks = [];
  }

  private end(): void {
    this.ended = true;
    for (const { recorder } of this.tracks) if (recorder.state !== 'inactive') recorder.stop();
    // The canvas track is this recorder's own. The camera track belongs to the game: it stays on.
    this.canvasTrack?.stop();
    this.canvasTrack = undefined;
  }
}
