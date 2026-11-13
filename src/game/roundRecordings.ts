import type { RecordingDelays } from './audio';
import { RECORDING } from './config';
import { clamp01 } from './numbers';
import { RoundRecorder, videoFileName } from './recording';
import type { RoundVideos } from './recording';
import type { RecordingScene } from './recordingScene';

/**
 * What the results screen shows of its round's recording:
 * - `none`: nothing. Recording is off, or did not start.
 * - `tail`: the recording still runs, for its last seconds after the results show.
 * - `finishing`: the recording has ended, and the recorder finishes the videos.
 * - `ready`: the videos, to watch and download.
 */
export type RecordingsView =
  | { stage: 'none' }
  | { stage: 'tail'; tailSec: number; passedSec: number }
  | { stage: 'finishing' }
  | { stage: 'ready'; videos: RoundVideos };

/** What the recordings use of a recorder. */
export type Recorder = Pick<RoundRecorder, 'active' | 'start' | 'drawFrame' | 'pause' | 'resume' | 'stop' | 'discard'>;

/** What a recording of a round needs. */
export interface RecordingSource {
  /** The song's sound for each video, each with its own delay. */
  sound: { game: MediaStream; camera: MediaStream };
  /** The camera picture. Unset with a test input. */
  video?: HTMLVideoElement;
  /** The id of the round's song, for the names of the files. */
  songId: string;
}

/**
 * How long a recording goes on after the results show: the cheer and the result card, and at
 * least until the end of the song has reached the video with the longest sound delay.
 */
export function recordingTailSec(delays: RecordingDelays): number {
  return Math.max(RECORDING.tailSec, Math.max(delays.game, delays.camera) + RECORDING.soundTailMarginSec);
}

/** The share of the tail that has passed, from 0 to 1. A tail of no length has passed. */
export function tailShare(passedSec: number, tailSec: number): number {
  return tailSec > 0 ? clamp01(passedSec / tailSec) : 1;
}

/**
 * Records the rounds of a visit while the players have recording on. It holds the videos of
 * one round only: the round whose results are on screen. The game says when a round begins,
 * when its results show, and when they close.
 */
export class RoundRecordings {
  private readonly onChange: () => void;
  private readonly createRecorder: () => Recorder | null;
  /** Records the round that runs now, and its last seconds after the results show. */
  private recorder?: Recorder;
  private songId = 'song';
  private stopTimer = 0;
  /** The last seconds after the results show, while they are recorded. */
  private tail?: { startedMs: number; durationSec: number };
  /** True while the recorder finishes the videos. */
  private finishing = false;
  /** The videos of the round whose results are on screen, once they are ready. */
  private videos?: RoundVideos;
  /**
   * Goes up whenever the round's recording is thrown away. Videos that arrive for an older
   * value belong to results that have closed: nothing keeps them.
   */
  private generation = 0;

  /**
   * `onChange` hears when a recording starts or ends, and when the stage of its videos changes.
   * `createRecorder` makes the recorder of a round, or null when the browser cannot record.
   * Tests give a stand-in.
   */
  constructor(onChange: () => void, createRecorder: () => Recorder | null = () => RoundRecorder.create()) {
    this.onChange = onChange;
    this.createRecorder = createRecorder;
  }

  /** True while a round is recorded. */
  get active(): boolean {
    return this.recorder?.active ?? false;
  }

  /** What the results show of the recording at `nowMs`, on the clock of `endAfter`. */
  view(nowMs: number): RecordingsView {
    if (this.tail) {
      return { stage: 'tail', tailSec: this.tail.durationSec, passedSec: (nowMs - this.tail.startedMs) / 1000 };
    }
    if (this.finishing) return { stage: 'finishing' };
    if (this.videos) return { stage: 'ready', videos: this.videos };
    return { stage: 'none' };
  }

  /**
   * A round begins, with its countdown. It starts with no videos. With a source, it is
   * recorded. A recording that cannot start never stops the round: the round then runs with
   * no recording.
   */
  begin(source?: RecordingSource): void {
    this.drop();
    if (!source) return;
    const recorder = this.createRecorder();
    if (!recorder) return;

    try {
      recorder.start(source.video, source.sound.game, source.sound.camera);
    } catch {
      // One video may have started before the other failed. Stop it: nothing else would.
      recorder.discard();
      return;
    }
    this.recorder = recorder;
    this.songId = source.songId;
    this.onChange();
  }

  /**
   * The results show. The recording goes on for `delaySec` from `nowMs`: the cheer and the
   * result card. Then the recorder finishes the videos.
   */
  endAfter(delaySec: number, nowMs: number): void {
    const recorder = this.recorder;
    if (!recorder?.active) return;
    window.clearTimeout(this.stopTimer);
    this.tail = { startedMs: nowMs, durationSec: delaySec };
    this.stopTimer = window.setTimeout(() => void this.finish(recorder), delaySec * 1000);
    this.onChange();
  }

  /**
   * The results close, or a round stops part-way. The recording of the round is thrown away:
   * one that still runs stops, videos still in the making are dropped when they arrive, and
   * ready videos are freed now. Close the video player first: it must not play a freed video.
   */
  drop(): void {
    this.clear();
    this.onChange();
  }

  /** Holds both videos while the round is paused, so the pause is not in them. */
  pause(): void {
    this.recorder?.pause();
  }

  resume(): void {
    this.recorder?.resume();
  }

  /** Draws a frame of the game view when one is due. Call it after the game has drawn its own canvas. */
  drawFrame(scene: RecordingScene): void {
    this.recorder?.drawFrame(scene);
  }

  /** The page goes away: everything is thrown away, as when the results close. */
  dispose(): void {
    this.clear();
  }

  private clear(): void {
    window.clearTimeout(this.stopTimer);
    this.generation++;
    this.recorder?.discard();
    this.recorder = undefined;
    this.tail = undefined;
    this.finishing = false;
    for (const video of this.videos?.videos ?? []) URL.revokeObjectURL(video.url);
    this.videos = undefined;
  }

  /** Ends the recording after its tail and makes its videos ready to watch and download. */
  private async finish(recorder: Recorder): Promise<void> {
    const generation = this.generation;
    const endedAt = new Date();
    const songId = this.songId;
    this.recorder = undefined;
    this.tail = undefined;
    this.finishing = true;
    this.onChange();
    const videos = await recorder.stop();
    // The results closed meanwhile. No page link was made, so the videos go with this call.
    if (generation !== this.generation) return;

    this.finishing = false;
    if (videos.length > 0) {
      this.videos = {
        videos: videos.map((video) => ({
          kind: video.kind,
          url: URL.createObjectURL(video.blob),
          fileName: videoFileName(songId, endedAt, video.kind, video.extension),
          sizeBytes: video.blob.size,
        })),
      };
    }
    this.onChange();
  }
}
