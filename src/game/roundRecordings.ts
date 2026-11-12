import type { SongAudio } from './audio';
import { PLAYER_COLORS } from './config';
import type { PlayerRun } from './player';
import { RECORDING, RoundRecorder, videoFileName } from './recording';
import type { RoundVideos } from './recording';
import type { RecordingScene, ResultLine } from './recordingScene';
import { playerHeading } from './resultText';
import { accuracy, stars } from './scoring';
import type { Settings } from './settings';

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
  audio: SongAudio;
  /** The camera picture. Unset with a test input. */
  video?: HTMLVideoElement;
  /** The round's song, for the names of the files. */
  song: { id: string; title: string };
  settings: Pick<Settings, 'avOffsetMs' | 'inputLatencyMs'>;
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
  private readonly onChange: () => void;
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
  /** The song's sound for the two videos, each with its own delay. They belong to `audio`. */
  private sound?: { audio: SongAudio; game: MediaStream; camera: MediaStream };

  /** `onChange` hears when a recording starts or ends, and when the list changes. */
  constructor(onChange: () => void) {
    this.onChange = onChange;
  }

  /** True while a round is recorded. */
  get active(): boolean {
    return this.recorder?.active ?? false;
  }

  get view(): RecordingsView {
    const status = this.active ? 'Recording the last seconds…' : this.finishing > 0 ? 'Finishing the video…' : '';
    return { rounds: this.rounds, status, lastRound: this.lastRound };
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

    const { audio, settings } = source;
    // In the game view, the sound must fit the cues: later by what the speakers add. In the
    // camera view it must fit the dancers: later again by what the camera adds.
    const heardLateSec = audio.outputLatencySec + settings.avOffsetMs / 1000;
    if (this.sound?.audio !== audio) {
      this.sound = {
        audio,
        game: audio.recordingStream(heardLateSec),
        camera: audio.recordingStream(heardLateSec + settings.inputLatencyMs / 1000),
      };
    }
    try {
      recorder.start(source.video, this.sound.game, this.sound.camera);
    } catch {
      return;
    }
    this.recorder = recorder;
    this.song = source.song;
    this.onChange();
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
    this.onChange();
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

  /** Draws one frame of the game view. Call it after the game has drawn its own canvas. */
  drawFrame(scene: RecordingScene): void {
    this.recorder?.drawFrame(scene);
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
    this.onChange();
    const videos = await recorder.stop();
    this.finishing--;

    if (videos.length > 0) {
      const time = endedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      const round: RoundVideos = {
        label: `${time} · ${song.title}`,
        videos: videos.map((video) => ({
          kind: video.kind,
          url: URL.createObjectURL(video.blob),
          fileName: videoFileName(song.id, endedAt, video.kind, video.extension),
          sizeBytes: video.blob.size,
        })),
      };
      this.rounds.unshift(round);
      // Videos are large: keep those of the last few rounds only.
      for (const old of this.rounds.splice(RECORDING.keepRounds)) {
        for (const video of old.videos) URL.revokeObjectURL(video.url);
      }
      // Until a newer round begins, its results may show these videos as a preview.
      if (roundNumber === this.roundNumber) this.lastRound = round;
    }
    this.onChange();
  }
}
