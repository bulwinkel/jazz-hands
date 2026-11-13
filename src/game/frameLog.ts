import type { FaceExpression, GestureName, TrackingFrame } from '../tracking/types';
import { roundTo } from './numbers';
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
  /** What its hand models ran on: 'GPU' or 'CPU'. Hands from the two differ. */
  delegate: string;
  players: LoggedPlayer[];
}

/** The tracker that made a frame. */
export interface FrameSource {
  mode: string;
  thread: string | null;
  delegate: string;
}


/**
 * One tracking frame as the log keeps it. Four decimals of a frame fraction are a fifth of a
 * pixel at 1920 pixels.
 */
export function logEntry(frame: TrackingFrame, phase: Phase, source: FrameSource): LoggedFrame {
  return {
    videoTimeSec: frame.videoTimeSec ?? null,
    timeMs: roundTo(frame.timeMs, 1),
    inferenceMs: roundTo(frame.inferenceMs, 1),
    phase,
    mode: source.mode,
    thread: source.thread,
    delegate: source.delegate,
    players: frame.players.map((player) => {
      const logged: LoggedPlayer = {
        hands: player.hands.map((hand) => ({
          x: roundTo(hand.x, 4),
          y: roundTo(hand.y, 4),
          size: roundTo(hand.size, 4),
          gesture: hand.gesture,
        })),
      };
      if (player.face) {
        const { smile, openMouth, pucker } = player.face.expressions;
        logged.face = {
          x: roundTo(player.face.x, 4),
          y: roundTo(player.face.y, 4),
          expressions: { smile: roundTo(smile, 4), openMouth: roundTo(openMouth, 4), pucker: roundTo(pucker, 4) },
        };
      }
      return logged;
    }),
  };
}
