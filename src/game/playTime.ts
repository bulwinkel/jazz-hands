/**
 * How long a round has been played: the stretches from its start, or from a resume, to a pause
 * or to now. A pause is not play.
 */
export interface PlayTime {
  /** Milliseconds of the stretches that have ended. */
  endedMs: number;
  /** The page time at which the current stretch began. Null while the round is paused. */
  stretchStartedMs: number | null;
}

export function startPlay(nowMs: number): PlayTime {
  return { endedMs: 0, stretchStartedMs: nowMs };
}

export function pausePlay(time: PlayTime, nowMs: number): PlayTime {
  if (time.stretchStartedMs === null) return time;
  return { endedMs: time.endedMs + (nowMs - time.stretchStartedMs), stretchStartedMs: null };
}

export function resumePlay(time: PlayTime, nowMs: number): PlayTime {
  return time.stretchStartedMs === null ? { ...time, stretchStartedMs: nowMs } : time;
}

/** Seconds of play up to `nowMs`, without the pauses. */
export function playedSec(time: PlayTime, nowMs: number): number {
  const currentMs = time.stretchStartedMs === null ? 0 : nowMs - time.stretchStartedMs;
  return (time.endedMs + currentMs) / 1000;
}

/**
 * True when a camera frame taken at page time `frameMs` belongs to the current stretch of play.
 * A frame taken before it, before the start or a pause, is not judged: its age would count the
 * pause as play, and it would be judged at the wrong song time.
 */
export function inCurrentStretch(time: PlayTime, frameMs: number): boolean {
  return time.stretchStartedMs !== null && frameMs >= time.stretchStartedMs;
}
