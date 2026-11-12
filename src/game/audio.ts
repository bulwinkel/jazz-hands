import { TIMING } from './config';

/**
 * Plays the song. Its audio context is the only clock in the game:
 * the cue animation and the judging both read `songTime`.
 */
export class SongAudio {
  readonly context = new AudioContext();
  /** Extra delay between sound and picture, set by the player. */
  avOffsetMs = 0;

  private buffer?: AudioBuffer;
  private source?: AudioBufferSourceNode;
  private gain?: GainNode;
  /** Context time at which the current playback started. */
  private startCtxTime = 0;
  /** Song position at which the current playback started. */
  private startOffsetSec = 0;
  /** Context time at which the current playback runs out. */
  private endCtxTime = 0;

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
