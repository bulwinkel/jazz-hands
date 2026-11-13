import { VEIL } from './colors';
import { PLAYER_COLORS } from './config';
import type { PlayerRun } from './player';
import { playerHeading, RESULTS_HEADING } from './resultText';
import { accuracy, stars } from './scoring';
import type { Rect } from './types';

/** One player's result, as the game view shows it at the end of the video. */
export interface ResultLine {
  title: string;
  color: string;
  stars: number;
  score: number;
  accuracyPercent: number;
}

/** Each player's result, as the end card of the game view shows it. */
export function resultLines(players: readonly PlayerRun[]): ResultLine[] {
  return players.map((player) => ({
    title: playerHeading(player),
    color: PLAYER_COLORS[player.index],
    stars: stars(player.score),
    score: Math.round(player.score.score),
    accuracyPercent: Math.round(accuracy(player.score) * 100),
  }));
}

/** What the game view shows in one frame. */
export interface RecordingScene {
  /** The camera picture. Unset with a test input. */
  video?: HTMLVideoElement;
  /** The game's own canvas: grids, cues and score. */
  overlay: HTMLCanvasElement;
  /** Where the camera frame is on that canvas, in the canvas's own pixels. */
  frame: Rect;
  /** The large message on screen, such as the countdown. */
  message?: { title: string; detail: string };
  /** Each player's result, once the round is over. */
  results?: readonly ResultLine[];
}

const BACKGROUND = '#080d20';
const RESULT_VEIL = 'rgba(8, 12, 32, 0.84)';
const FONT = 'system-ui, sans-serif';

/** Fills the game view with its background colour, as before the first frame. */
export function clearScene(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

/** Draws one frame of the game view over the whole canvas of `ctx`. */
export function drawScene(ctx: CanvasRenderingContext2D, scene: RecordingScene): void {
  const { width, height } = ctx.canvas;
  clearScene(ctx);
  if (scene.video && scene.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    // Mirrored, as on screen: the grids are drawn for the mirrored picture.
    ctx.save();
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(scene.video, 0, 0, width, height);
    ctx.restore();
  }
  ctx.fillStyle = VEIL;
  ctx.fillRect(0, 0, width, height);

  const { frame } = scene;
  if (frame.width > 0 && frame.height > 0) {
    ctx.drawImage(scene.overlay, frame.x, frame.y, frame.width, frame.height, 0, 0, width, height);
  }
  if (scene.results) drawResults(ctx, scene.results);
  else if (scene.message) drawMessage(ctx, scene.message.title, scene.message.detail);
}

/** The large message of the screen. A countdown number is drawn very large, as on screen. */
function drawMessage(ctx: CanvasRenderingContext2D, title: string, detail: string): void {
  const { height, width } = ctx.canvas;
  const isCountdown = title.length <= 2;
  const titleSize = height * (isCountdown ? 0.34 : 0.08);
  const y = height * (isCountdown ? 0.4 : 0.44);
  text(ctx, title, width / 2, y, titleSize, '#ffffff');
  if (detail) text(ctx, detail, width / 2, y + titleSize * 0.62 + height * 0.04, height * 0.045, '#fef08a');
}

/** The end card: a heading and one column for each player. */
function drawResults(ctx: CanvasRenderingContext2D, results: readonly ResultLine[]): void {
  const { height, width } = ctx.canvas;
  ctx.fillStyle = RESULT_VEIL;
  ctx.fillRect(0, 0, width, height);
  text(ctx, RESULTS_HEADING, width / 2, height * 0.17, height * 0.1, '#ffffff');

  const columnWidth = Math.min(width * 0.36, (width * 0.84) / results.length);
  const gap = width * 0.04;
  const left = (width - (columnWidth * results.length + gap * (results.length - 1))) / 2;
  results.forEach((result, i) => {
    const x = left + i * (columnWidth + gap);
    const centre = x + columnWidth / 2;
    ctx.beginPath();
    ctx.roundRect(x, height * 0.3, columnWidth, height * 0.5, height * 0.03);
    ctx.fillStyle = 'rgba(17, 23, 43, 0.8)';
    ctx.fill();
    ctx.strokeStyle = result.color;
    ctx.lineWidth = Math.max(2, height * 0.004);
    ctx.stroke();

    text(ctx, result.title, centre, height * 0.37, height * 0.042, result.color);
    text(ctx, '★'.repeat(result.stars) + '☆'.repeat(5 - result.stars), centre, height * 0.47, height * 0.07, '#fde047');
    text(ctx, result.score.toLocaleString(), centre, height * 0.6, height * 0.1, '#ffffff');
    text(ctx, `${result.accuracyPercent}% accuracy`, centre, height * 0.72, height * 0.04, '#cbd5e1');
  });
}

function text(ctx: CanvasRenderingContext2D, content: string, x: number, y: number, size: number, color: string): void {
  ctx.font = `800 ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = size * 0.25;
  ctx.fillStyle = color;
  ctx.fillText(content, x, y);
  ctx.shadowBlur = 0;
}
