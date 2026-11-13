import { TIMING } from './config';
import { AV_OFFSET_RANGE_MS, INPUT_LATENCY_RANGE_MS } from './settings';

/** Room for the speakers' own delay in a recording's sound. Bluetooth speakers add about 0.3 s. */
const OUTPUT_LATENCY_ROOM_SEC = 1;
/**
 * The longest delay a recording's sound can need: the largest picture offset and camera delay
 * the settings allow, plus the speakers' delay.
 */
export const MAX_RECORDING_DELAY_SEC =
  (AV_OFFSET_RANGE_MS[1] + INPUT_LATENCY_RANGE_MS[1]) / 1000 + OUTPUT_LATENCY_ROOM_SEC;

/** How late each video of a recording carries the song's sound, in seconds. */
export interface RecordingDelays {
  game: number;
  camera: number;
}

/**
 * The delays of a recording's sound. The speakers and the camera both add a delay to what a
 * video shows, so its sound must come later by the same amount. In the game view, the sound
 * must fit the cues: later by what the speakers add, and by the picture offset. In the camera
 * view it must fit the dancers: later again by what the camera adds.
 */
export function recordingDelays(outputLatencySec: number, avOffsetMs: number, inputLatencyMs: number): RecordingDelays {
  const gameSec = outputLatencySec + avOffsetMs / 1000;
  return { game: applicableDelay(gameSec), camera: applicableDelay(gameSec + inputLatencyMs / 1000) };
}

/**
 * A delay node can only make the sound later. A negative total would ask for the sound earlier
 * than the song plays it, which cannot be done: no shift is applied, and the video's sound is
 * then late by that much.
 */
function applicableDelay(sec: number): number {
  return Math.max(0, Math.min(MAX_RECORDING_DELAY_SEC, sec));
}

/** A copy of the song's sound for one video, behind its own delay. */
interface RecordingTap {
  delay: DelayNode;
  stream: MediaStream;
}

/**
 * Plays the song. Its audio context is the only clock in the game:
 * the cue animation and the judging both read `songTime`.
 */
export class SongAudio {
  readonly context = new AudioContext();
  /** Extra delay between sound and picture, set by the player. */
  private avOffsetMs = 0;
  /** The camera's delay, set by the player. The camera view of a recording follows it. */
  private inputLatencyMs = 0;

  private buffer?: AudioBuffer;
  private source?: AudioBufferSourceNode;
  private gain?: GainNode;
  /** Context time at which the current playback started. */
  private startCtxTime = 0;
  /** Song position at which the current playback started. */
  private startOffsetSec = 0;
  /** Context time at which the current playback runs out. */
  private endCtxTime = 0;
  /** The song's sound for the two videos of a recording. Made once, for the first recording. */
  private recordingTaps?: { game: RecordingTap; camera: RecordingTap };

  /** Delay between the context clock and the sound leaving the speakers. */
  get outputLatencySec(): number {
    return this.context.outputLatency || this.context.baseLatency || 0;
  }

  /** The song position the player hears right now, in seconds. */
  get songTime(): number {
    const playedSec = this.context.currentTime - this.startCtxTime;
    return this.startOffsetSec + playedSec - this.outputLatencySec - this.avOffsetMs / 1000;
  }

  /** True once the sound has played to its end. Unlike `songTime`, no offset moves this moment. */
  get ended(): boolean {
    return this.source !== undefined && this.context.currentTime >= this.endCtxTime;
  }

  /** Sets the player's offsets. The song clock follows the picture offset, and a recording's sound follows both. */
  setOffsets(avOffsetMs: number, inputLatencyMs: number): void {
    this.avOffsetMs = avOffsetMs;
    this.inputLatencyMs = inputLatencyMs;
    this.setRecordingDelays();
  }

  /**
   * The song's sound for the two videos of a recording, each with its own delay. Ask for the
   * streams before `play`. Each call sets the delays again, from the offsets and the speakers'
   * delay of that moment.
   */
  recordingStreams(): { game: MediaStream; camera: MediaStream } {
    this.recordingTaps ??= { game: this.createTap(), camera: this.createTap() };
    this.setRecordingDelays();
    return { game: this.recordingTaps.game.stream, camera: this.recordingTaps.camera.stream };
  }

  /** The delays of a recording's sound now, from the offsets and the speakers' delay. */
  get soundDelays(): RecordingDelays {
    return recordingDelays(this.outputLatencySec, this.avOffsetMs, this.inputLatencyMs);
  }

  private setRecordingDelays(): void {
    if (!this.recordingTaps) return;
    const delays = this.soundDelays;
    this.recordingTaps.game.delay.delayTime.value = delays.game;
    this.recordingTaps.camera.delay.delayTime.value = delays.camera;
  }

  private createTap(): RecordingTap {
    const delay = this.context.createDelay(MAX_RECORDING_DELAY_SEC);
    const output = this.context.createMediaStreamDestination();
    delay.connect(output);
    // A source of silence that is always on. Without it, the stream stops while no song
    // plays, and a video then has no sound track for its countdown and its last seconds.
    const silence = this.context.createConstantSource();
    silence.offset.value = 0;
    silence.connect(output);
    silence.start();
    return { delay, stream: output.stream };
  }

  async load(url: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Audio load failed (${response.status}).`);
    try {
      this.buffer = await this.context.decodeAudioData(await response.arrayBuffer());
    } catch {
      throw new Error('Audio decode failed. Check the local MP3 file.');
    }
  }

  /** Suspending the context freezes the clock, so pause and resume keep cues and sound together. */
  async pause(): Promise<void> {
    await this.context.suspend();
  }

  async resume(): Promise<void> {
    await this.context.resume();
  }

  /**
   * Plays from `offsetSec` to `endSec`. With `fadeOut`, the last seconds fade to silence.
   * A start inside the song fades in.
   */
  play(offsetSec: number, endSec: number, fadeOut: boolean): void {
    if (!this.buffer) throw new Error('The song is not loaded.');
    if (this.buffer.duration + 0.1 < endSec) throw new Error('The audio is shorter than the song manifest.');
    this.stop();

    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = this.buffer;
    source.connect(gain);
    gain.connect(this.context.destination);
    if (this.recordingTaps) {
      gain.connect(this.recordingTaps.game.delay);
      gain.connect(this.recordingTaps.camera.delay);
    }

    // Start slightly in the future so the first samples are never cut.
    this.startCtxTime = this.context.currentTime + 0.1;
    this.startOffsetSec = offsetSec;
    const durationSec = endSec - offsetSec;
    this.endCtxTime = this.startCtxTime + durationSec;

    if (offsetSec > 0) {
      gain.gain.setValueAtTime(0, this.startCtxTime);
      gain.gain.linearRampToValueAtTime(1, this.startCtxTime + TIMING.fadeInSec);
    } else {
      gain.gain.setValueAtTime(1, this.startCtxTime);
    }
    if (fadeOut) {
      gain.gain.setValueAtTime(1, Math.max(this.startCtxTime, this.endCtxTime - TIMING.fadeSec));
      gain.gain.linearRampToValueAtTime(0, this.endCtxTime);
    }
    source.start(this.startCtxTime, offsetSec, durationSec);
    this.source = source;
    this.gain = gain;
  }

  stop(): void {
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        // The source had already stopped.
      }
      this.source.disconnect();
    }
    this.gain?.disconnect();
    this.source = undefined;
    this.gain = undefined;
  }

  close(): void {
    this.stop();
    void this.context.close();
  }
}
