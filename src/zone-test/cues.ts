/**
 * Sound for a person who stands across the room: spoken lines and beeps.
 * The words on screen stay the main cue. Sound can be muted, missing or blocked.
 */

/** A low beep says a new phase begins. A high beep says the recording runs. */
export const PHASE_BEEP_HZ = 520;
export const RECORD_BEEP_HZ = 1040;

const BEEP_SEC = 0.18;
const BEEP_VOLUME = 0.2;
/** A little slower than normal speech, to be clear over the noise of a room. */
const SPEECH_RATE = 0.95;

/**
 * The voice and the beeps of a run.
 *
 * A silent one makes no sound at all. Automated checks need that: speech comes from the
 * system voice, so muting the browser does not stop it, and it would talk into the room.
 */
export class SoundCues {
  private readonly silent: boolean;
  private context?: AudioContext;

  constructor(silent: boolean) {
    this.silent = silent;
  }

  /** Call this from a click or a key press. A browser lets a page beep only after one. */
  unlock(): void {
    if (this.silent || !('AudioContext' in window)) return;
    try {
      this.context ??= new AudioContext();
      void this.context.resume().catch(() => {});
    } catch {
      // No beeps. The words on screen remain.
    }
  }

  /** Says a line aloud. A line that is still being said is cut off: the new one matters more. */
  say(line: string): void {
    if (this.silent || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(line);
      utterance.rate = SPEECH_RATE;
      speechSynthesis.speak(utterance);
    } catch {
      // The words on screen remain.
    }
  }

  beep(pitchHz: number): void {
    const context = this.context;
    if (!context || context.state !== 'running') return;

    const oscillator = context.createOscillator();
    const volume = context.createGain();
    oscillator.frequency.value = pitchHz;
    volume.gain.setValueAtTime(BEEP_VOLUME, context.currentTime);
    volume.gain.exponentialRampToValueAtTime(0.001, context.currentTime + BEEP_SEC);
    oscillator.connect(volume).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + BEEP_SEC);
  }

  /** Stops a line that is being said. */
  hush(): void {
    if (!this.silent && 'speechSynthesis' in window) speechSynthesis.cancel();
  }

  close(): void {
    this.hush();
    void this.context?.close().catch(() => {});
    this.context = undefined;
  }
}
