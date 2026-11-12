import { GAME_CONFIG as C } from './config';
/** This context is the only clock used for song playback and judgment. */
export class SongAudio {
  readonly context = new AudioContext();
  private buffer?: AudioBuffer;
  private source?: AudioBufferSourceNode;
  private gain?: GainNode;
  private startCtxTime = 0;
  private offset = 0;
  avOffsetMs = 0;
  get outputLatency(): number { return this.context.outputLatency || this.context.baseLatency || 0; }
  get songTime(): number { return this.context.currentTime - this.startCtxTime + this.offset - this.outputLatency - this.avOffsetMs / 1000; }
  async load(url: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Audio load failed (${response.status}).`);
    try { this.buffer = await this.context.decodeAudioData(await response.arrayBuffer()); }
    catch { throw new Error('Audio decode failed. Check the local MP3 file.'); }
  }
  async resume(): Promise<void> { await this.context.resume(); }
  async pause(): Promise<void> { await this.context.suspend(); }
  play(offset: number, end: number, short: boolean): void {
    if (!this.buffer) throw new Error('The song is not loaded.');
    if (this.buffer.duration + 0.1 < end) throw new Error('The audio is shorter than the song manifest.');
    this.stop(); this.offset = offset; this.startCtxTime = this.context.currentTime + 0.1;
    const source = this.context.createBufferSource(); const gain = this.context.createGain();
    source.buffer = this.buffer; source.connect(gain); gain.connect(this.context.destination);
    const duration = end - offset;
    gain.gain.setValueAtTime(1, this.startCtxTime);
    if (short) {
      gain.gain.setValueAtTime(1, this.startCtxTime + Math.max(0, duration - C.fadeSec));
      gain.gain.linearRampToValueAtTime(0, this.startCtxTime + duration);
    }
    source.start(this.startCtxTime, offset, duration);
    this.source = source; this.gain = gain;
  }
  stop(): void {
    if (this.source) { try { this.source.stop(); } catch { /* Already stopped. */ } this.source.disconnect(); }
    this.gain?.disconnect(); this.source = undefined; this.gain = undefined;
  }
  close(): void { this.stop(); void this.context.close(); }
}
