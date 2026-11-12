import type { GestureName, TrackingFrame } from '../tracking/types';
import { GESTURE_EMOJI, HANDS_UP_CELL, LEVELS, PLAYER_COLORS, TIMING } from './config';
import { cellRect, containRect } from './geometry';
import type { CueState } from './judgment';
import type { PlayerRun } from './player';
import type { Manifest, Phase, PlayerIndex, Point, Rating, Rect } from './types';

/** A short flash that tells a player how a cue went. */
export interface Feedback {
  player: PlayerIndex;
  cell: number;
  result: Rating;
  /** `performance.now()` when the cue became final. */
  atMs: number;
}

export interface RenderView {
  phase: Phase;
  players: readonly PlayerRun[];
  frame?: TrackingFrame;
  songTimeSec: number;
  manifest?: Manifest;
  endSec: number;
  feedback: readonly Feedback[];
}

const HIDDEN_PHASES: readonly Phase[] = ['menu', 'loading', 'error'];
const RATING_COLORS: Record<Rating, string> = { perfect: '#fde047', good: '#86efac', miss: '#fb5c76' };
const WHITE = '#ffffff';
/** The grid border glows for this long after each beat. */
const BEAT_PULSE_SEC = 0.22;
/** A cue's closing outline starts this many times larger than its cell. */
const OUTLINE_START_SCALE = 2.2;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const centreOf = (rect: Rect): Point => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
const lerp = (from: Point, to: Point, t: number): Point => ({
  x: from.x + (to.x - from.x) * t,
  y: from.y + (to.y - from.y) * t,
});

/** A `#rrggbb` colour with an alpha from 0 to 1, as `#rrggbbaa`. */
function withAlpha(hex: string, alpha: number): string {
  const byte = Math.round(clamp01(alpha) * 255);
  return hex + byte.toString(16).padStart(2, '0');
}

function scaleAboutCentre(rect: Rect, scale: number): Rect {
  return {
    x: rect.x - (rect.width * (scale - 1)) / 2,
    y: rect.y - (rect.height * (scale - 1)) / 2,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

/** 1 on a beat, fading to 0 shortly after. */
function beatPulse(manifest: Manifest | undefined, songTimeSec: number): number {
  const lastBeat = manifest?.beats.findLast((time) => time <= songTimeSec);
  if (lastBeat === undefined) return 0;
  return Math.max(0, 1 - (songTimeSec - lastBeat) / BEAT_PULSE_SEC);
}

/**
 * Draws the game on one canvas laid over the camera picture.
 * Game positions are fractions of the camera frame. `toScreen` maps them onto the part of
 * the canvas where the frame is shown, so drawings line up with the players' bodies.
 */
export class GameRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** Where the camera frame is shown on the canvas, in CSS pixels. */
  private frameRect: Rect = { x: 0, y: 0, width: 1, height: 1 };
  private width = 0;
  private height = 0;
  private pixelRatio = 0;
  /** Base text size, scaled with the screen so it reads from across a room. */
  private textSize = 24;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is unavailable.');
    this.canvas = canvas;
    this.ctx = ctx;
  }

  draw(view: RenderView, videoAspect: number): void {
    this.resize(videoAspect);
    if (HIDDEN_PHASES.includes(view.phase)) return;

    const pulse = beatPulse(view.manifest, view.songTimeSec);
    for (const player of view.players) {
      const color = PLAYER_COLORS[player.index];
      if (view.phase !== 'results') this.drawGrid(player.grid, color, pulse);
      if (view.phase === 'play') this.drawCues(player, view.songTimeSec, color);
      if (view.phase === 'ready' || view.phase === 'results') this.drawHandsUpTarget(player, color);
      if (view.phase !== 'results') this.drawHud(player, view.phase, color);
      this.drawHands(player, view.frame, color);
    }
    this.drawFeedback(view);
    if (view.phase === 'play') this.drawProgress(view.songTimeSec / view.endSec);
  }

  /** Matches the canvas to its on-screen size and clears it. */
  private resize(videoAspect: number): void {
    const bounds = this.canvas.getBoundingClientRect();
    const pixelRatio = window.devicePixelRatio || 1;
    if (bounds.width !== this.width || bounds.height !== this.height || pixelRatio !== this.pixelRatio) {
      this.width = bounds.width;
      this.height = bounds.height;
      this.pixelRatio = pixelRatio;
      this.canvas.width = Math.round(bounds.width * pixelRatio);
      this.canvas.height = Math.round(bounds.height * pixelRatio);
    }
    this.ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.frameRect = containRect(this.width, this.height, videoAspect);
    this.textSize = Math.max(22, Math.min(42, this.frameRect.width * 0.025));
  }

  private toScreen(rect: Rect): Rect {
    const frame = this.frameRect;
    return {
      x: frame.x + rect.x * frame.width,
      y: frame.y + rect.y * frame.height,
      width: rect.width * frame.width,
      height: rect.height * frame.height,
    };
  }

  // --- Grid and cues ---

  private drawGrid(grid: Rect, color: string, pulse: number): void {
    for (let cell = 0; cell < 9; cell++) {
      this.outline(this.toScreen(cellRect(grid, cell)), withAlpha(color, 0.44), 1.5);
    }
    this.outline(this.toScreen(grid), withAlpha(color, 0.27 + pulse * 0.5), 2 + pulse * 3);
  }

  private drawCues(player: PlayerRun, nowSec: number, color: string): void {
    const { approachSec, goodMs } = LEVELS[player.level];
    const onScreen = player.states.filter((state) => {
      if (state.result) return false;
      const lastDueSec = state.cue.times[state.cue.times.length - 1];
      return nowSec >= state.cue.timeSec - approachSec && nowSec <= lastDueSec + goodMs[1] / 1000;
    });
    // Draw later cues first, faint. The next cue due goes on top at full strength.
    for (let i = onScreen.length - 1; i >= 0; i--) {
      const isNext = i === 0;
      if (onScreen[i].cue.kind === 'slide') this.drawSlide(onScreen[i], player, nowSec, color, isNext);
      else this.drawTap(onScreen[i], player, nowSec, color, isNext);
    }
  }

  private drawTap(state: CueState, player: PlayerRun, nowSec: number, color: string, isNext: boolean): void {
    const { cue, marks } = state;
    const rects = cue.cells.map((cell) => this.toScreen(cellRect(player.grid, cell)));
    const remaining = (cue.timeSec - nowSec) / LEVELS[player.level].approachSec;

    // Two cells at once: a line joins them, so it reads as one move for two hands.
    if (rects.length === 2) {
      this.line(centreOf(rects[0]), centreOf(rects[1]), withAlpha(color, isNext ? 0.6 : 0.25), 5);
    }
    rects.forEach((rect, k) => {
      this.drawTargetCell(rect, color, isNext, marks[k] === 'perfect');
      this.drawClosingOutline(rect, remaining, color, isNext);
      this.drawCellMarker(rect, color, cue.gesture);
    });
  }

  private drawSlide(state: CueState, player: PlayerRun, nowSec: number, color: string, isNext: boolean): void {
    const { cue, marks } = state;
    const [fromRect, toRect] = cue.cells.map((cell) => this.toScreen(cellRect(player.grid, cell)));
    const [startSec, endSec] = cue.times;
    const from = centreOf(fromRect);
    const to = centreOf(toRect);
    const cellSize = Math.min(fromRect.width, fromRect.height);
    const strength = isNext ? 1 : 0.45;
    /** 0 until the slide starts, 1 when the hand is due in the far cell. */
    const progress = clamp01((nowSec - startSec) / (endSec - startSec));

    // The path: a wide band from the first cell to the far cell, with an arrowhead.
    this.line(from, to, withAlpha(color, 0.32 * strength), cellSize * 0.35);
    this.drawArrowHead(from, to, cellSize * 0.26, withAlpha(WHITE, 0.8 * strength));

    // The first cell works like a tap: its outline closes when the slide starts.
    this.drawTargetCell(fromRect, color, isNext, marks[0] === 'perfect');
    this.drawClosingOutline(fromRect, (startSec - nowSec) / LEVELS[player.level].approachSec, color, isNext);

    // The far cell lights up as the dot arrives.
    if (marks[1] === 'perfect') {
      this.drawTargetCell(toRect, color, isNext, true);
    } else {
      const border = withAlpha(color, (0.5 + 0.5 * progress) * strength);
      const fill = withAlpha(color, (0.1 + 0.3 * progress) * strength);
      this.outline(toRect, border, 2 + 3 * progress, fill);
    }

    // The dot to follow. It waits on the first cell, then travels with the beat.
    const dot = lerp(from, to, progress);
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = strength;
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, cellSize * 0.11, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** A cell the player must reach. A cell that is already hit fills in, so the hit is visible. */
  private drawTargetCell(rect: Rect, color: string, isNext: boolean, done: boolean): void {
    const fillAlpha = done ? 0.72 : isNext ? 0.31 : 0.13;
    this.outline(rect, color, isNext ? 4 : 2, withAlpha(color, fillAlpha));
  }

  /** The timing cue: an outline that shrinks onto the cell border and meets it on the beat. */
  private drawClosingOutline(rect: Rect, remaining: number, color: string, isNext: boolean): void {
    const scale = 1 + (OUTLINE_START_SCALE - 1) * clamp01(remaining);
    this.ctx.save();
    this.ctx.globalAlpha = isNext ? 0.9 : 0.35;
    this.outline(scaleAboutCentre(rect, scale), color, 4);
    this.ctx.restore();
  }

  /** The middle of a target cell: the hand shape to make, or a plain dot. */
  private drawCellMarker(rect: Rect, color: string, gesture: GestureName | undefined): void {
    const centre = centreOf(rect);
    if (gesture) {
      this.text(GESTURE_EMOJI[gesture] ?? '✋', centre.x, centre.y, Math.min(rect.width, rect.height) * 0.5);
      return;
    }
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc(centre.x, centre.y, Math.max(5, this.textSize * 0.18), 0, Math.PI * 2);
    this.ctx.fill();
  }

  private drawArrowHead(from: Point, to: Point, size: number, color: string): void {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    // The tip stops short of the cell centre so the dot does not hide it on arrival.
    const tip = { x: to.x - Math.cos(angle) * size * 0.6, y: to.y - Math.sin(angle) * size * 0.6 };
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(4, size * 0.22);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const side of [-1, 1]) {
      const wing = angle + Math.PI + side * 0.6;
      ctx.moveTo(tip.x + Math.cos(wing) * size, tip.y + Math.sin(wing) * size);
      ctx.lineTo(tip.x, tip.y);
    }
    ctx.stroke();
  }

  // --- Ready check, HUD, hands ---

  /** The cell to hold a hand in, with a ring that fills while the hand stays. */
  private drawHandsUpTarget(player: PlayerRun, color: string): void {
    const target = this.toScreen(cellRect(player.grid, HANDS_UP_CELL));
    const centre = centreOf(target);
    const radius = Math.min(target.width, target.height) * 0.32;
    const ctx = this.ctx;

    this.outline(target, color, 4, withAlpha(color, 0.21));
    ctx.strokeStyle = color;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * player.hold);
    ctx.stroke();
    this.text('✋', centre.x, centre.y, radius * 1.25);
  }

  private drawHud(player: PlayerRun, phase: Phase, color: string): void {
    const grid = this.toScreen(player.grid);
    const size = this.textSize;
    if (phase !== 'play') {
      // During play the score row takes this space.
      const label = `P${player.index + 1} · LEVEL ${player.level}`;
      this.text(label, grid.x + grid.width / 2, Math.max(size * 0.65, grid.y - size * 0.9), size * 0.65, color);
      return;
    }
    const y = Math.max(size * 1.5, grid.y - size * 0.75);
    this.text(Math.round(player.score.score).toLocaleString(), grid.x + grid.width * 0.28, y, size);
    this.text(`${player.score.combo} COMBO`, grid.x + grid.width * 0.75, y, size * 0.72, color);
  }

  /** A ring on every tracked palm, so players see what the game sees. */
  private drawHands(player: PlayerRun, frame: TrackingFrame | undefined, color: string): void {
    if (!frame || performance.now() - frame.timeMs > TIMING.staleFrameMs) return;
    const ctx = this.ctx;
    for (const hand of frame.players[player.index].hands) {
      const x = this.frameRect.x + hand.x * this.frameRect.width;
      const y = this.frameRect.y + hand.y * this.frameRect.height;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 5;
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(13, this.frameRect.height * 0.025), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      // With hand shapes on, show the shape the tracker reads, so a player can correct it.
      const emoji = player.shapes ? GESTURE_EMOJI[hand.gesture] : undefined;
      if (emoji) this.text(emoji, x + this.textSize, y, this.textSize * 0.7);
    }
  }

  // --- Feedback and progress ---

  private drawFeedback(view: RenderView): void {
    const nowMs = performance.now();
    for (const item of view.feedback) {
      const player = view.players.find((p) => p.index === item.player);
      const ageSec = (nowMs - item.atMs) / 1000;
      if (!player || ageSec > TIMING.feedbackSec) continue;

      const rect = this.toScreen(cellRect(player.grid, item.cell));
      const centre = centreOf(rect);
      const color = RATING_COLORS[item.result];
      const ctx = this.ctx;
      ctx.save();
      ctx.globalAlpha = 1 - ageSec / TIMING.feedbackSec;
      if (item.result === 'miss') this.outline(rect, color, 5, withAlpha(color, 0.33));
      if (item.result === 'perfect') this.drawBurst(centre, ageSec, color);
      this.text(item.result.toUpperCase(), centre.x, centre.y - ageSec * 30, this.textSize * 0.85, color);
      ctx.restore();
    }
  }

  /** A ring of sparks that flies outward. */
  private drawBurst(centre: Point, ageSec: number, color: string): void {
    const ctx = this.ctx;
    const distance = 15 + ageSec * 140;
    ctx.fillStyle = color;
    for (let spark = 0; spark < 12; spark++) {
      const angle = (spark * Math.PI) / 6;
      ctx.beginPath();
      ctx.arc(
        centre.x + Math.cos(angle) * distance,
        centre.y + Math.sin(angle) * distance,
        Math.max(0, 5 * (1 - ageSec)),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }

  private drawProgress(fraction: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = withAlpha(WHITE, 0.15);
    ctx.fillRect(0, 0, this.width, 8);
    ctx.fillStyle = RATING_COLORS.perfect;
    ctx.fillRect(0, 0, this.width * clamp01(fraction), 8);
    const hint = 'SPACE pause   ·   R restart   ·   ESC menu';
    this.text(hint, this.width / 2, this.height - this.textSize * 0.7, this.textSize * 0.48, '#e2e8f0');
  }

  // --- Drawing primitives ---

  private outline(rect: Rect, color: string, lineWidth: number, fill?: string): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.width, rect.height, Math.min(16, rect.width * 0.12));
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  private line(from: Point, to: Point, color: string, lineWidth: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  private text(content: string, x: number, y: number, size: number, color: string = WHITE): void {
    const ctx = this.ctx;
    ctx.font = `800 ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#080c20';
    ctx.shadowBlur = 8;
    ctx.fillStyle = color;
    ctx.fillText(content, x, y);
    ctx.shadowBlur = 0;
  }
}
