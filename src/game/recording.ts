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
 */

export const RECORDING = {
  /** The game view is this high. Its width follows the camera's shape. */
  gameHeight: 720,
  frameRate: 30,
  gameBitsPerSec: 4_000_000,
  /** The camera view keeps the camera's own size, 1080p on a recent laptop. */
  cameraBitsPerSec: 6_000_000,
  audioBitsPerSec: 128_000,
  /** The recording goes on this long after the results show: the cheer, and the result card. */
  tailSec: 4,
  /** The game keeps the videos of this many rounds. Older ones are dropped, to free memory. */
  keepRounds: 3,
} as const;

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

/** One finished video. */
export interface RecordedVideo {
  kind: VideoKind;
  blob: Blob;
  extension: string;
}

/** The videos of one round, ready to download. */
export interface RoundVideos {
  /** Names the round for as long as the game keeps it. A new round gets a new id. */
  id: number;
  /** For example "20:41 · Todo Bueno". */
  label: string;
  videos: { kind: VideoKind; url: string; fileName: string; sizeBytes: number }[];
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
  private canvasTrack?: MediaStreamTrack;
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

    [this.canvasTrack] = this.canvas.captureStream(RECORDING.frameRate).getVideoTracks();
    this.record('game', [this.canvasTrack, ...gameAudio.getAudioTracks()], RECORDING.gameBitsPerSec);

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

  /** Draws one frame of the game view. Call it after the game has drawn its own canvas. */
  drawFrame(scene: RecordingScene): void {
    if (this.active) drawScene(this.ctx, scene);
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
