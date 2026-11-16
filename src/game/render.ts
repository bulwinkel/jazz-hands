import type { GestureName, TrackingFrame } from '../tracking/types';
import { cueColor, withAlpha } from './colors';
import { markScale } from './cueMark';
import {
  CALIBRATE_CELL,
  FACE_EMOJI,
  GESTURE_EMOJI,
  HOLD_CELL_LABELS,
  LEVELS,
  PLAYER_COLORS,
  START_CELL,
  TIMING,
} from './config';
import { openFaceCue } from './faceJudgment';
import { cellRect, containRect } from './geometry';
import { holdCellLayout } from './holdCellLayout';
import type { HoldCellLayout } from './holdCellLayout';
import type { CueState } from './judgment';
import { clamp, clamp01 } from './numbers';
import type { PlayerRun } from './player';
import { canvasFont, signOffset } from './signInk';
import type { Manifest, Phase, PlayerIndex, Point, Rating, Rect } from './types';

/** A short flash that tells a player how a cue went. */
export interface Feedback {
  player: PlayerIndex;
  /** Where the flash shows: the grid cell of a hand cue, or the player's face for a face cue. */
  target: number | 'face';
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
  /** The round plays the song from `startSec` to `endSec`. */
  startSec: number;
  endSec: number;
  feedback: readonly Feedback[];
  /** True while the round is recorded as video. The key hints then stay out of the picture. */
  recording?: boolean;
}

const HIDDEN_PHASES: readonly Phase[] = ['menu', 'loading', 'error'];
const RATING_COLORS: Record<Rating, string> = { perfect: '#fde047', good: '#86efac', miss: '#fb5c76' };
const WHITE = '#ffffff';
/** The grid border glows for this long after each beat. */
const BEAT_PULSE_SEC = 0.22;
/** A face cue's emoji, as a share of the shorter side of a grid cell. Large, to read from 2.5 m. */
const FACE_EMOJI_SCALE = 0.7;
/** The emoji is a little see-through, so a hand cue under it stays visible. */
const FACE_EMOJI_ALPHA = 0.8;
/** The ring around the emoji, as a share of the emoji size. It sits just outside the emoji. */
const FACE_RING_SCALE = 0.6;
/** The dashes of the Calibrate cell's outline, as [dash, gap] in pixels. */
const CALIBRATE_DASH = [10, 8];
/** The strength of the Calibrate cell's sign and word: lower than the Start cell's, as the second choice. */
const CALIBRATE_ALPHA = 0.7;

const centreOf = (rect: Rect): Point => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

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
    // Measure every sign now. The first sign of a round then costs no time in its frame.
    const holdCellSigns = Object.values(HOLD_CELL_LABELS).map((label) => label.sign);
    for (const sign of [...Object.values(GESTURE_EMOJI), ...Object.values(FACE_EMOJI), ...holdCellSigns]) {
      signOffset(sign);
    }
  }

  draw(view: RenderView, videoAspect: number): void {
    this.resize(videoAspect);
    if (HIDDEN_PHASES.includes(view.phase)) return;

    const pulse = beatPulse(view.manifest, view.songTimeSec);
    for (const player of view.players) {
      const color = PLAYER_COLORS[player.index];
      if (view.phase !== 'results') this.drawGrid(player.grid, color, pulse);
      if (view.phase === 'play') this.drawCues(player, view.songTimeSec, color);
      if (view.phase === 'play') this.drawFaceCue(player, view.songTimeSec, color);
      // The results draw the Start cell with no word: there it plays again.
      if (view.phase === 'ready') this.drawStartCell(player, color, HOLD_CELL_LABELS.start.word);
      if (view.phase === 'results') this.drawStartCell(player, color, null);
      // In a calibration of one player, the other player sees their own Calibrate hold go on.
      const waitsToCalibrate = view.phase === 'fit' && player.calibrateHold > 0;
      if (view.phase === 'ready' || waitsToCalibrate) this.drawCalibrateCell(player, color);
      if (view.phase !== 'results') this.drawHud(player, view.phase, color);
      this.drawHands(player, view.frame, color);
    }
    this.drawFeedback(view);
    if (view.phase === 'play') {
      this.drawProgress((view.songTimeSec - view.startSec) / (view.endSec - view.startSec), !view.recording);
    }
  }

  /** Where the camera frame is on the canvas, in the canvas's own pixels. A recording cuts this part out. */
  get framePixels(): Rect {
    const scale = this.pixelRatio || 1;
    const { x, y, width, height } = this.frameRect;
    return { x: x * scale, y: y * scale, width: width * scale, height: height * scale };
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
    this.textSize = clamp(this.frameRect.width * 0.025, 22, 42);
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

  private pointToScreen(point: Point): Point {
    const frame = this.frameRect;
    return { x: frame.x + point.x * frame.width, y: frame.y + point.y * frame.height };
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
      return nowSec >= state.cue.timeSec - approachSec && nowSec <= state.cue.timeSec + goodMs[1] / 1000;
    });
    // The next cue due is drawn at full strength. Later cues are faint.
    const cues = onScreen.map((state, i) => ({ state, isNext: i === 0 }));
    const latestFirst = [...cues].reverse();

    // Earlier cues first. Two cues for one cell then nest: the later, smaller block lies on the
    // earlier, larger one, and both show. The hand shapes come after all blocks, the earliest
    // last: the shape on top is the one of the cue that is due first.
    for (const { state, isNext } of cues) this.drawTap(state, player, nowSec, color, isNext);
    for (const { state } of latestFirst) this.drawShapes(state, player);
  }

  /**
   * The hand shape to make, in the middle of each cell of a cue. A tap with no hand shape has
   * nothing there: its block marks the middle of the cell.
   */
  private drawShapes(state: CueState, player: PlayerRun): void {
    const { gesture } = state.cue;
    if (!gesture) return;
    for (const rect of this.cellRects(state, player)) this.drawGesture(rect, gesture);
  }

  /** The cells of a cue, on the canvas. */
  private cellRects(state: CueState, player: PlayerRun): Rect[] {
    return state.cue.cells.map((cell) => this.toScreen(cellRect(player.grid, cell)));
  }

  /** A tap: a block in each of its cells. Each cell of a slide is a tap of its own. */
  private drawTap(state: CueState, player: PlayerRun, nowSec: number, playerColor: string, isNext: boolean): void {
    const { cue, marks } = state;
    const rects = this.cellRects(state, player);
    const remaining = (cue.timeSec - nowSec) / LEVELS[player.level].approachSec;
    // The colour says how soon the cue is due, so several cues on screen show their order.
    const color = cueColor(playerColor, remaining);

    // Two cells at once: a line joins them, so it reads as one move for two hands.
    if (rects.length === 2) {
      this.line(centreOf(rects[0]), centreOf(rects[1]), withAlpha(color, isNext ? 0.6 : 0.25), 5);
    }
    rects.forEach((rect, k) => {
      this.drawCueCell(rect, remaining, color, isNext, marks[k] === 'perfect');
    });
  }

  /**
   * One cell of a cue, with the mark that shows when to be in it. `remaining` is the share of
   * the approach time still to go. The cell has a thin border, and a block grows from its
   * middle until it fills the cell on the beat.
   */
  private drawCueCell(rect: Rect, remaining: number, color: string, isNext: boolean, done: boolean): void {
    if (done) {
      // A cell that is already hit fills in, so the hit is visible.
      this.outline(rect, color, isNext ? 4 : 2, withAlpha(color, 0.72));
      return;
    }
    this.outline(rect, withAlpha(color, isNext ? 0.7 : 0.35), 2);
    const block = scaleAboutCentre(rect, markScale(remaining));
    // Solid enough that a small block shows on the larger block of an earlier cue.
    this.outline(block, color, isNext ? 3 : 2, withAlpha(color, isNext ? 0.62 : 0.4));
  }

  /** The hand shape to make, in the middle of a cue cell. */
  private drawGesture(rect: Rect, gesture: GestureName): void {
    const centre = centreOf(rect);
    this.sign(GESTURE_EMOJI[gesture] ?? '✋', centre.x, centre.y, Math.min(rect.width, rect.height) * 0.5);
  }

  // --- Face cues ---

  /**
   * The face to pull: an emoji laid over the player's own face like a mask, in a ring. A
   * second ring grows from the middle and meets the first on the beat, as the block of a hand
   * cue fills its cell.
   */
  private drawFaceCue(player: PlayerRun, nowSec: number, playerColor: string): void {
    const state = openFaceCue(player.faceStates, player.level, nowSec);
    if (!state) return;

    const centre = this.faceCueCentre(player);
    const emojiSize = this.faceEmojiSize(player);
    const radius = emojiSize * FACE_RING_SCALE;
    const remaining = (state.cue.timeSec - nowSec) / LEVELS[player.level].approachSec;
    const color = cueColor(playerColor, remaining);
    const markRadius = radius * markScale(remaining);
    const ctx = this.ctx;

    ctx.save();
    ctx.globalAlpha = FACE_EMOJI_ALPHA;
    this.sign(FACE_EMOJI[state.cue.expression], centre.x, centre.y, emojiSize);
    ctx.restore();

    this.ring(centre, radius, color, 4);
    ctx.save();
    ctx.globalAlpha = 0.9;
    this.ring(centre, markRadius, color, 4);
    ctx.restore();
  }

  /**
   * Where a face cue and its result show, on the canvas. That is on the player's face once
   * the tracker has found it. Before that, it is the top-centre of the grid: near the head,
   * and clear of the score row above the grid.
   */
  private faceCueCentre(player: PlayerRun): Point {
    if (player.faceSeenAt) return this.pointToScreen(player.faceSeenAt);
    const grid = this.toScreen(player.grid);
    const radius = this.faceEmojiSize(player) * FACE_RING_SCALE;
    return { x: grid.x + grid.width / 2, y: grid.y + radius };
  }

  private faceEmojiSize(player: PlayerRun): number {
    const cell = this.toScreen(cellRect(player.grid, 0));
    return Math.min(cell.width, cell.height) * FACE_EMOJI_SCALE;
  }

  // --- Ready screen, HUD, hands ---

  /**
   * The Start cell: a hand held in it starts the round, or plays again on the results. A ring
   * fills while the hand stays. `word` goes under the sign: "Start" on the ready screen, where
   * the Calibrate cell is a second choice, and none on the results.
   */
  private drawStartCell(player: PlayerRun, color: string, word: string | null): void {
    const cell = this.toScreen(cellRect(player.grid, START_CELL));
    const layout = this.holdCellLayout(cell, word);
    this.outline(cell, color, 4, withAlpha(color, 0.21));
    this.holdRing(layout.centre, layout.radius, color, 10, player.hold);
    this.sign(HOLD_CELL_LABELS.start.sign, layout.centre.x, layout.centre.y, layout.radius * 1.25);
    this.drawWord(word, layout);
  }

  /**
   * The Calibrate cell: a hand held in it calibrates its player. It is the second choice, so
   * it is fainter than the Start cell: a thin dashed outline, and a thinner ring.
   */
  private drawCalibrateCell(player: PlayerRun, color: string): void {
    const cell = this.toScreen(cellRect(player.grid, CALIBRATE_CELL));
    const { sign, word } = HOLD_CELL_LABELS.calibrate;
    const layout = this.holdCellLayout(cell, word);
    const ctx = this.ctx;

    ctx.save();
    ctx.setLineDash(CALIBRATE_DASH);
    this.outline(cell, withAlpha(color, 0.6), 2.5, withAlpha(color, 0.08));
    ctx.restore();
    this.holdRing(layout.centre, layout.radius, withAlpha(color, 0.85), 6, player.calibrateHold);
    ctx.save();
    ctx.globalAlpha = CALIBRATE_ALPHA;
    this.sign(sign, layout.centre.x, layout.centre.y, layout.radius * 1.1);
    this.drawWord(word, layout);
    ctx.restore();
  }

  /**
   * Lays out a Start or Calibrate cell (see holdCellLayout.ts). The word gets the base text size,
   * which reads from across a room, or less where it would not fit the cell.
   */
  private holdCellLayout(cell: Rect, word: string | null): HoldCellLayout {
    const wordWidth = word === null ? null : this.textWidth(word, this.textSize);
    return holdCellLayout(cell, this.textSize, wordWidth, this.width);
  }

  /** The word of a Start or Calibrate cell, where its layout puts it. Nothing for a cell with no word. */
  private drawWord(word: string | null, layout: HoldCellLayout): void {
    if (word === null || layout.word === null) return;
    this.text(word, layout.word.x, layout.word.y, layout.word.size);
  }

  /** A ring that fills clockwise from the top while a hand holds a cell. `progress` goes from 0 to 1. */
  private holdRing(centre: Point, radius: number, color: string, lineWidth: number, progress: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.stroke();
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
      if (emoji) this.sign(emoji, x + this.textSize, y, this.textSize * 0.7);
    }
  }

  // --- Feedback and progress ---

  private drawFeedback(view: RenderView): void {
    const nowMs = performance.now();
    for (const item of view.feedback) {
      const player = view.players.find((p) => p.index === item.player);
      const ageSec = (nowMs - item.atMs) / 1000;
      if (!player || ageSec > TIMING.feedbackSec) continue;

      const color = RATING_COLORS[item.result];
      const missFill = withAlpha(color, 0.33);
      const ctx = this.ctx;
      ctx.save();
      ctx.globalAlpha = 1 - ageSec / TIMING.feedbackSec;
      let centre: Point;
      if (item.target === 'face') {
        centre = this.faceCueCentre(player);
        const radius = this.faceEmojiSize(player) * FACE_RING_SCALE;
        if (item.result === 'miss') this.ring(centre, radius, color, 5, missFill);
      } else {
        const rect = this.toScreen(cellRect(player.grid, item.target));
        centre = centreOf(rect);
        if (item.result === 'miss') this.outline(rect, color, 5, missFill);
      }
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

  private drawProgress(fraction: number, withKeyHints: boolean): void {
    const ctx = this.ctx;
    ctx.fillStyle = withAlpha(WHITE, 0.15);
    ctx.fillRect(0, 0, this.width, 8);
    ctx.fillStyle = RATING_COLORS.perfect;
    ctx.fillRect(0, 0, this.width * clamp01(fraction), 8);
    if (!withKeyHints) return;
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

  private ring(centre: Point, radius: number, color: string, lineWidth: number, fill?: string): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
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

  /**
   * A hand shape or a face, with the middle of its picture on the point. Text is centred by
   * the numbers of its font, and those do not fit the picture of every sign in every browser.
   */
  private sign(content: string, x: number, y: number, size: number): void {
    const { dx, dy } = signOffset(content);
    this.text(content, x - dx * size, y - dy * size, size);
  }

  /** The width of `content` in the canvas font at `size` pixels. */
  private textWidth(content: string, size: number): number {
    this.ctx.font = canvasFont(size);
    return this.ctx.measureText(content).width;
  }

  private text(content: string, x: number, y: number, size: number, color: string = WHITE): void {
    const ctx = this.ctx;
    ctx.font = canvasFont(size);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#080c20';
    ctx.shadowBlur = 8;
    ctx.fillStyle = color;
    ctx.fillText(content, x, y);
    ctx.shadowBlur = 0;
  }
}
