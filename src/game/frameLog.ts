import type { FaceExpression, GestureName, TrackingFrame } from '../tracking/types';
import type { Phase } from './types';

/**
 * With `framelog=1` in the URL, the game keeps every tracking frame in a log, for scripts that
 * compare runs (see `scripts/compare-threads.mjs`). An entry keeps what the game judges by,
 * rounded, and leaves out the landmarks, so that a script can read thousands of them at once.
 */

export interface LoggedHand {
  x: number;
  y: number;
  size: number;
  gesture: GestureName;
}

export interface LoggedFace {
  x: number;
  y: number;
  expressions: Record<FaceExpression, number>;
}

export interface LoggedPlayer {
  hands: LoggedHand[];
  face?: LoggedFace;
}

export interface LoggedFrame {
  /** The camera frame's time on the camera stream's own clock. Null when the input gave none. */
  videoTimeSec: number | null;
  /** The page's performance.now() when the camera frame was taken. */
  timeMs: number;
  inferenceMs: number;
  phase: Phase;
  /** The tracker mode that made the frame. */
  mode: string;
  /** Where that tracker ran. Null for a test input. */
  thread: string | null;
  players: LoggedPlayer[];
}

/** The tracker that made a frame. */
export interface FrameSource {
  mode: string;
  thread: string | null;
}

/** Four decimals of a frame fraction are a fifth of a pixel at 1920 pixels. */
const round4 = (value: number): number => Math.round(value * 10000) / 10000;
const round1 = (value: number): number => Math.round(value * 10) / 10;

/** One tracking frame as the log keeps it. */
export function logEntry(frame: TrackingFrame, phase: Phase, source: FrameSource): LoggedFrame {
  return {
    videoTimeSec: frame.videoTimeSec ?? null,
    timeMs: round1(frame.timeMs),
    inferenceMs: round1(frame.inferenceMs),
    phase,
    mode: source.mode,
    thread: source.thread,
    players: frame.players.map((player) => {
      const logged: LoggedPlayer = {
        hands: player.hands.map((hand) => ({
          x: round4(hand.x),
          y: round4(hand.y),
          size: round4(hand.size),
          gesture: hand.gesture,
        })),
      };
      if (player.face) {
        const { smile, openMouth, pucker } = player.face.expressions;
        logged.face = {
          x: round4(player.face.x),
          y: round4(player.face.y),
          expressions: { smile: round4(smile), openMouth: round4(openMouth), pucker: round4(pucker) },
        };
      }
      return logged;
    }),
  };
}
