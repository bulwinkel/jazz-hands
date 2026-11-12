import type { GestureName, TrackingFrame } from '../tracking/types';
import { cueColor, withAlpha } from './colors';
import { FACE_EMOJI, GESTURE_EMOJI, HANDS_UP_CELL, LEVELS, PLAYER_COLORS, TIMING } from './config';
import { openFaceCue } from './faceJudgment';
import { cellRect, containRect } from './geometry';
import type { CueState } from './judgment';
import type { PlayerRun } from './player';
import type { Manifest, Phase, PlayerIndex, Point, Rating, Rect, SlideSpeed } from './types';

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
/** A cue's closing outline starts this many times larger than its cell. */
const OUTLINE_START_SCALE = 2.2;
/** Arrowheads on a slide's path, so a player sees its speed before it starts. */
const SLIDE_CHEVRONS: Record<SlideSpeed, number> = { slow: 1, normal: 2, fast: 3 };
/** A face cue's emoji, as a share of the shorter side of a grid cell. Large, to read from 2.5 m. */
const FACE_EMOJI_SCALE = 0.7;
/** The emoji is a little see-through, so a hand cue under it stays visible. */
const FACE_EMOJI_ALPHA = 0.8;
/** The ring around the emoji, as a share of the emoji size. It sits just outside the emoji. */
const FACE_RING_SCALE = 0.6;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const centreOf = (rect: Rect): Point => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
const lerp = (from: Point, to: Point, t: number): Point => ({
  x: from.x + (to.x - from.x) * t,
  y: from.y + (to.y - from.y) * t,
});

/** Where the slide dot is: in each cell of the path at that cell's due time, moving evenly between. */
function pointOnPath(path: readonly Point[], times: readonly number[], nowSec: number): Point {
  const last = path.length - 1;
  if (nowSec <= times[0]) return path[0];
  if (nowSec >= times[last]) return path[last];
  const leg = times.findIndex((_, k) => k < last && nowSec < times[k + 1]);
  return lerp(path[leg], path[leg + 1], (nowSec - times[leg]) / (times[leg + 1] - times[leg]));
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
      if (view.phase === 'play') this.drawFaceCue(player, view.songTimeSec, color);
      if (view.phase === 'ready' || view.phase === 'results') this.drawHandsUpTarget(player, color);
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
      const lastDueSec = state.cue.times[state.cue.times.length - 1];
      return nowSec >= state.cue.timeSec - approachSec && nowSec <= lastDueSec + goodMs[1] / 1000;
    });
    // Draw later cues first, faint. The next cue due goes on top at full strength, and so does
    // every cue due while it still runs: a tap for the other hand during a slow slide belongs
    // to the same moment.
    const currentEndsSec = onScreen.length > 0 ? Math.max(...onScreen[0].cue.times) : 0;
    for (let i = onScreen.length - 1; i >= 0; i--) {
      const isNext = i === 0 || onScreen[i].cue.timeSec <= currentEndsSec;
      if (onScreen[i].cue.kind === 'slide') this.drawSlide(onScreen[i], player, nowSec, color, isNext);
      else this.drawTap(onScreen[i], player, nowSec, color, isNext);
    }
  }

  private drawTap(state: CueState, player: PlayerRun, nowSec: number, playerColor: string, isNext: boolean): void {
    const { cue, marks } = state;
    const rects = cue.cells.map((cell) => this.toScreen(cellRect(player.grid, cell)));
    const remaining = (cue.timeSec - nowSec) / LEVELS[player.level].approachSec;
    // The colour says how soon the cue is due, so several cues on screen show their order.
    const color = cueColor(playerColor, remaining);

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

  private drawSlide(state: CueState, player: PlayerRun, nowSec: number, playerColor: string, isNext: boolean): void {
    const { cue, marks } = state;
    const { approachSec } = LEVELS[player.level];
    const rects = cue.cells.map((cell) => this.toScreen(cellRect(player.grid, cell)));
    // Each cell has the colour of its own due time. The path fades from the colour of its first
    // cell to that of its last, so the end to start from is the one nearer the due colour.
    const colors = cue.times.map((dueSec) => cueColor(playerColor, (dueSec - nowSec) / approachSec));
    const path = rects.map(centreOf);
    const last = rects.length - 1;
    const startSec = cue.times[0];
    const endSec = cue.times[last];
    const cellSize = Math.min(rects[0].width, rects[0].height);
    const strength = isNext ? 1 : 0.45;
    /** 0 until the slide starts, 1 when the hand is due in the last cell. */
    const progress = clamp01((nowSec - startSec) / (endSec - startSec));

    // The path: a wide band from the first cell to the last. Chevrons at its end show the
    // speed before the slide starts: one for slow, two for normal, three for fast.
    const band = this.fade(path[0], path[last], colors.map((color) => withAlpha(color, 0.32 * strength)));
    this.line(path[0], path[last], band, cellSize * 0.35);
    const chevrons = SLIDE_CHEVRONS[cue.speed ?? 'normal'];
    this.drawChevrons(path[0], path[last], chevrons, cellSize * 0.24, withAlpha(WHITE, 0.8 * strength));

    // The first cell works like a tap: its outline closes when the slide starts.
    this.drawTargetCell(rects[0], colors[0], isNext, marks[0] === 'perfect');
    this.drawClosingOutline(rects[0], (startSec - nowSec) / approachSec, colors[0], isNext);

    // A slow slide passes through a middle cell, which is judged on its own beat.
    for (let k = 1; k < last; k++) this.drawTargetCell(rects[k], colors[k], false, marks[k] === 'perfect');

    // The last cell lights up as the dot arrives.
    if (marks[last] === 'perfect') {
      this.drawTargetCell(rects[last], colors[last], isNext, true);
    } else {
      const border = withAlpha(colors[last], (0.5 + 0.5 * progress) * strength);
      const fill = withAlpha(colors[last], (0.1 + 0.3 * progress) * strength);
      this.outline(rects[last], border, 2 + 3 * progress, fill);
    }

    // The dot to follow. It waits on the first cell, then is in each cell at that cell's due time.
    // When the slide asks for a hand shape, the shape itself is the dot.
    const dot = pointOnPath(path, cue.times, nowSec);
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = strength;
    if (cue.gesture) {
      this.text(GESTURE_EMOJI[cue.gesture] ?? '✋', dot.x, dot.y, cellSize * 0.42);
    } else {
      // The dot glows in the colour of the first cell: the due colour from the start of the slide.
      ctx.shadowColor = colors[0];
      ctx.shadowBlur = 18;
      ctx.fillStyle = WHITE;
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, cellSize * 0.11, 0, Math.PI * 2);
      ctx.fill();
    }
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

  /** Arrowheads that point from `from` to `to`, stacked back from the end of the path. */
  private drawChevrons(from: Point, to: Point, count: number, size: number, color: string): void {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(4, size * 0.22);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let chevron = 0; chevron < count; chevron++) {
      // The first tip stops short of the cell centre, so the dot does not hide it on arrival.
      const back = size * (0.6 + chevron * 0.75);
      const tip = { x: to.x - Math.cos(angle) * back, y: to.y - Math.sin(angle) * back };
      for (const side of [-1, 1]) {
        const wing = angle + Math.PI + side * 0.6;
        ctx.moveTo(tip.x + Math.cos(wing) * size, tip.y + Math.sin(wing) * size);
        ctx.lineTo(tip.x, tip.y);
      }
    }
    ctx.stroke();
  }

  // --- Face cues ---

  /**
   * The face to pull: an emoji laid over the player's own face like a mask, with a ring
   * that closes onto it and meets it on the beat, as the outline of a hand cue does.
   */
  private drawFaceCue(player: PlayerRun, nowSec: number, playerColor: string): void {
    const state = openFaceCue(player.faceStates, player.level, nowSec);
    if (!state) return;

    const centre = this.faceCueCentre(player);
    const emojiSize = this.faceEmojiSize(player);
    const radius = emojiSize * FACE_RING_SCALE;
    const remaining = (state.cue.timeSec - nowSec) / LEVELS[player.level].approachSec;
    const color = cueColor(playerColor, remaining);
    const closingScale = 1 + (OUTLINE_START_SCALE - 1) * clamp01(remaining);
    const ctx = this.ctx;

    ctx.save();
    ctx.globalAlpha = FACE_EMOJI_ALPHA;
    this.text(FACE_EMOJI[state.cue.expression], centre.x, centre.y, emojiSize);
    ctx.restore();

    this.ring(centre, radius, color, 4);
    ctx.save();
    ctx.globalAlpha = 0.9;
    this.ring(centre, radius * closingScale, color, 4);
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

  /** A stroke colour that fades along the line from `from` to `to`, through the colours in order. */
  private fade(from: Point, to: Point, colors: readonly string[]): CanvasGradient {
    const gradient = this.ctx.createLinearGradient(from.x, from.y, to.x, to.y);
    colors.forEach((color, k) => gradient.addColorStop(k / (colors.length - 1), color));
    return gradient;
  }

  private line(from: Point, to: Point, color: string | CanvasGradient, lineWidth: number): void {
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
