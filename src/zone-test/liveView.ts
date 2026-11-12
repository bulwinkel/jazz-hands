import type { GestureName } from '../tracking/types';
import type { ZoneFrame, ZoneHand } from '../tracking/zones';
import { ZONE_COLORS } from './config';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What to write beside a hand for each shape the finger reader knows. */
const SHAPE_LABELS: Partial<Record<GestureName, string>> = {
  open: 'OPEN',
  fist: 'FIST',
  peace: 'PEACE',
  point: 'POINT',
};
/** Written beside a hand whose fingers match no shape. */
const NO_SHAPE_LABEL = '?';

/** Sizes as shares of the picture width, so the drawing reads the same on any screen. */
const RING_RADIUS = 0.022;
const TEXT_SIZE = 0.034;
/** The zone numbers sit this far down the picture, clear of the status line at the top. */
const ZONE_NUMBER_Y = 0.16;

const OUTLINE = '#000000';
const BORDER = '#ffffffb0';

/** The largest rectangle of the given aspect ratio that fits a box, centred. */
function pictureRect(boxWidth: number, boxHeight: number, aspect: number): Rect {
  const width = Math.min(boxWidth, boxHeight * aspect);
  const height = width / aspect;
  return { x: (boxWidth - width) / 2, y: (boxHeight - height) / 2, width, height };
}

/**
 * Draws the zones and the tracked hands on a canvas that lies over the camera picture.
 * Positions are fractions of the mirrored frame, mapped onto the part of the canvas where the
 * picture is shown, so the drawings line up with the bodies.
 */
export class LiveView {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** Where the camera picture is on the canvas, in CSS pixels. */
  private picture: Rect = { x: 0, y: 0, width: 1, height: 1 };

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is unavailable.');
    this.canvas = canvas;
    this.ctx = ctx;
  }

  draw(zones: number, frame: ZoneFrame | undefined, videoAspect: number): void {
    this.fitToScreen(videoAspect);
    this.drawZones(zones);
    frame?.zones.forEach((hands, zone) => {
      for (const hand of hands) this.drawHand(hand, ZONE_COLORS[zone]);
    });
  }

  /** Matches the canvas to its size on screen, and clears it. */
  private fitToScreen(videoAspect: number): void {
    const { clientWidth, clientHeight } = this.canvas;
    const pixelRatio = window.devicePixelRatio || 1;
    const width = Math.round(clientWidth * pixelRatio);
    const height = Math.round(clientHeight * pixelRatio);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    this.ctx.clearRect(0, 0, clientWidth, clientHeight);
    this.picture = pictureRect(clientWidth, clientHeight, videoAspect);
  }

  private toScreen(x: number, y: number): { x: number; y: number } {
    return { x: this.picture.x + x * this.picture.width, y: this.picture.y + y * this.picture.height };
  }

  private get textSize(): number {
    return this.picture.width * TEXT_SIZE;
  }

  /** Text with a dark outline, readable on any camera picture. */
  private drawText(text: string, x: number, y: number, color: string, size: number): void {
    const { ctx } = this;
    ctx.font = `900 ${size}px system-ui, sans-serif`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = size / 5;
    ctx.strokeStyle = OUTLINE;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  /** A line down each border between two zones, and the number of each zone in its colour. */
  private drawZones(zones: number): void {
    const { ctx } = this;
    ctx.strokeStyle = BORDER;
    ctx.lineWidth = 3;
    for (let border = 1; border < zones; border++) {
      const top = this.toScreen(border / zones, 0);
      const bottom = this.toScreen(border / zones, 1);
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(bottom.x, bottom.y);
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let zone = 0; zone < zones; zone++) {
      const centre = this.toScreen((zone + 0.5) / zones, ZONE_NUMBER_Y);
      this.drawText(String(zone + 1), centre.x, centre.y, ZONE_COLORS[zone], this.textSize * 1.4);
    }
  }

  /** A ring on the palm in the colour of its zone, and the shape the finger reader sees beside it. */
  private drawHand(hand: ZoneHand, color: string): void {
    const { ctx } = this;
    const palm = this.toScreen(hand.x, hand.y);
    const radius = this.picture.width * RING_RADIUS;

    ctx.beginPath();
    ctx.arc(palm.x, palm.y, radius, 0, Math.PI * 2);
    ctx.lineWidth = 12;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.lineWidth = 7;
    ctx.strokeStyle = color;
    ctx.stroke();

    // The label goes to the right of the ring, or to the left when the picture ends there.
    const label = SHAPE_LABELS[hand.gesture] ?? NO_SHAPE_LABEL;
    ctx.font = `900 ${this.textSize}px system-ui, sans-serif`;
    const gap = radius * 1.4;
    const fitsOnRight = palm.x + gap + ctx.measureText(label).width < this.picture.x + this.picture.width;
    ctx.textAlign = fitsOnRight ? 'left' : 'right';
    ctx.textBaseline = 'middle';
    this.drawText(label, palm.x + (fitsOnRight ? gap : -gap), palm.y, color, this.textSize);
  }
}
