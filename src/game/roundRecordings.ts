import type { RecordingDelays } from './audio';
import { PLAYER_COLORS } from './config';
import type { PlayerRun } from './player';
import { RECORDING, RoundRecorder, videoFileName } from './recording';
import type { RoundVideos } from './recording';
import type { RecordingScene, ResultLine } from './recordingScene';
import { playerHeading } from './resultText';
import { accuracy, stars } from './scoring';

/** What the list of recorded rounds shows. */
export interface RecordingsView {
  /** The videos of the last rounds, newest first. */
  rounds: readonly RoundVideos[];
  /** A line about a recording that is not finished yet. Empty when there is none. */
  status: string;
  /** The videos of the last round, once they are ready, until the next round begins. */
  lastRound?: RoundVideos;
}

/** What a recording of a round needs. */
export interface RecordingSource {
  /** The song's sound for each video, each with its own delay. */
  sound: { game: MediaStream; camera: MediaStream };
  /** The camera picture. Unset with a test input. */
  video?: HTMLVideoElement;
  /** The round's song, for the names of the files. */
  song: { id: string; title: string };
}

/** What the recordings ask of the game. */
export interface RecordingsHooks {
  /** Hears when a recording starts or ends, and when the list changes. */
  onChange: () => void;
  /** True while the video player shows `round`. */
  isOnShow: (round: RoundVideos) => boolean;
}

/**
 * How long a recording goes on after the results show: the cheer and the result card, and at
 * least until the end of the song has reached the video with the longest sound delay.
 */
export function recordingTailSec(delays: RecordingDelays): number {
  return Math.max(RECORDING.tailSec, Math.max(delays.game, delays.camera) + RECORDING.soundTailMarginSec);
}

/** Puts `round` first and keeps the newest `keep` rounds. Returns the kept rounds and the dropped ones. */
export function addRound<T>(rounds: readonly T[], round: T, keep: number): { kept: T[]; dropped: T[] } {
  const all = [round, ...rounds];
  return { kept: all.slice(0, keep), dropped: all.slice(keep) };
}

/** The line above the list of rounds while a recording is not finished yet. Empty when none is. */
export function recordingStatus(isRecording: boolean, finishing: number): string {
  if (isRecording) return 'Recording the last seconds…';
  return finishing > 0 ? 'Finishing the video…' : '';
}

/** Each player's result, as the end card of the game view shows it. */
export function resultLines(players: readonly PlayerRun[]): ResultLine[] {
  return players.map((player) => ({
    title: playerHeading(player),
    color: PLAYER_COLORS[player.index],
    stars: stars(player.score),
    score: Math.round(player.score.score),
    accuracyPercent: Math.round(accuracy(player.score) * 100),
  }));
}

/**
 * Records the rounds of a visit, while the players have recording on, and keeps the videos
 * of the last few. The game says when a round begins and ends, and whether its videos are kept.
 */
export class RoundRecordings {
  private readonly hooks: RecordingsHooks;
  /** Records the round that runs now. */
  private recorder?: RoundRecorder;
  private song = { id: 'song', title: '' };
  private stopTimer = 0;
  /** Recordings that have ended and are not yet ready to download. */
  private finishing = 0;
  /** The videos of the last rounds, newest first. */
  private rounds: RoundVideos[] = [];
  /** Counts the rounds of this visit, so a finished recording knows whether a newer round has begun. */
  private roundNumber = 0;
  private lastRound?: RoundVideos;
  private nextRoundId = 1;
  /** Rounds dropped from the list while the video player showed them. They are freed when it closes. */
  private droppedOnShow: RoundVideos[] = [];

  constructor(hooks: RecordingsHooks) {
    this.hooks = hooks;
  }

  /** True while a round is recorded. */
  get active(): boolean {
    return this.recorder?.active ?? false;
  }

  get view(): RecordingsView {
    return { rounds: this.rounds, status: recordingStatus(this.active, this.finishing), lastRound: this.lastRound };
  }

  /**
   * A round begins, with its countdown. With a source, it is recorded. A recording that
   * cannot start never stops the round: the round then runs with no recording.
   */
  begin(source?: RecordingSource): void {
    this.roundNumber++;
    this.lastRound = undefined;
    if (!source) return;
    const recorder = RoundRecorder.create();
    if (!recorder) return;

    try {
      recorder.start(source.video, source.sound.game, source.sound.camera);
    } catch {
      // One video may have started before the other failed. Stop it: nothing else would.
      recorder.discard();
      return;
    }
    this.recorder = recorder;
    this.song = source.song;
    this.hooks.onChange();
  }

  /**
   * Ends the recording of this round, if one runs. With `keep`, its videos go in the list.
   * Without, they are thrown away.
   */
  end(keep: boolean): void {
    window.clearTimeout(this.stopTimer);
    const recorder = this.recorder;
    this.recorder = undefined;
    if (recorder?.active) {
      if (keep) void this.keep(recorder, this.song);
      else recorder.discard();
    }
    this.hooks.onChange();
  }

  /** Keeps the recording on for `delaySec`, then ends it and keeps its videos. */
  endAfter(delaySec: number): void {
    if (!this.active) return;
    window.clearTimeout(this.stopTimer);
    this.stopTimer = window.setTimeout(() => this.end(true), delaySec * 1000);
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

  /**
   * Frees the videos of the rounds that left the list, except a round the video player shows
   * now: it is freed when the player closes. Call it then.
   */
  freeDropped(): void {
    const onShow = this.droppedOnShow.filter((round) => this.hooks.isOnShow(round));
    for (const round of this.droppedOnShow) {
      if (!onShow.includes(round)) for (const video of round.videos) URL.revokeObjectURL(video.url);
    }
    this.droppedOnShow = onShow;
  }

  dispose(): void {
    window.clearTimeout(this.stopTimer);
    this.recorder?.discard();
  }

  /** Finishes the videos of a round and puts them in the list to download. */
  private async keep(recorder: RoundRecorder, song: { id: string; title: string }): Promise<void> {
    const endedAt = new Date();
    const roundNumber = this.roundNumber;
    this.finishing++;
    this.hooks.onChange();
    const videos = await recorder.stop();
    this.finishing--;

    if (videos.length > 0) {
      const time = endedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      const round: RoundVideos = {
        id: this.nextRoundId++,
        label: `${time} · ${song.title}`,
        videos: videos.map((video) => ({
          kind: video.kind,
          url: URL.createObjectURL(video.blob),
          fileName: videoFileName(song.id, endedAt, video.kind, video.extension),
          sizeBytes: video.blob.size,
        })),
      };
      // Videos are large: keep those of the last few rounds only.
      const { kept, dropped } = addRound(this.rounds, round, RECORDING.keepRounds);
      this.rounds = kept;
      this.droppedOnShow.push(...dropped);
      this.freeDropped();
      // Until a newer round begins, its results may show these videos as a preview.
      if (roundNumber === this.roundNumber) this.lastRound = round;
    }
    this.hooks.onChange();
  }
}
