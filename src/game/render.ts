import type { TrackingFrame } from '../tracking/types';
import { GAME_CONFIG as C, GESTURE_EMOJI, PLAYER_COLORS } from './config';
import { cellCentre, cellRect, containRect } from './geometry';
import type { CueState } from './judgment';
import type { Manifest, Phase, PlayerLevel, Rating, Rect, Score } from './types';
export interface Feedback { cell: number; result: Rating; at: number; player: number }
export interface RenderView {
  phase: Phase; grids: [Rect, Rect]; levels: [PlayerLevel, PlayerLevel]; scores: [Score, Score];
  states: [CueState[], CueState[]]; frame?: TrackingFrame; songTime: number; manifest?: Manifest;
  end: number; hold: [number, number]; feedback: Feedback[];
}
export class GameRenderer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private visible: Rect = { x: 0, y: 0, width: 1, height: 1 };
  private width = 0;
  private height = 0;
  private dpr = 0;
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas 2D is unavailable.'); this.context = context;
  }
  private rect(r: Rect): Rect { const f = this.visible; return { x: f.x + r.x * f.width, y: f.y + r.y * f.height, width: r.width * f.width, height: r.height * f.height }; }
  private outline(r: Rect, color: string, width = 2, fill?: string): void {
    const c = this.context; c.beginPath(); c.roundRect(r.x, r.y, r.width, r.height, Math.min(16, r.width * 0.12));
    if (fill) { c.fillStyle = fill; c.fill(); } c.strokeStyle = color; c.lineWidth = width; c.stroke();
  }
  private text(text: string, x: number, y: number, size: number, color = '#fff'): void {
    const c = this.context; c.font = `800 ${size}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.shadowColor = '#080c20'; c.shadowBlur = 8; c.fillStyle = color; c.fillText(text, x, y); c.shadowBlur = 0;
  }
  draw(v: RenderView, aspect = 16 / 9): void {
    const c = this.context; const b = this.canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
    if (b.width !== this.width || b.height !== this.height || dpr !== this.dpr) {
      this.width = b.width; this.height = b.height; this.dpr = dpr;
      this.canvas.width = Math.round(b.width * dpr); this.canvas.height = Math.round(b.height * dpr);
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, this.width, this.height);
    this.visible = containRect(this.width, this.height, aspect);
    if (['menu', 'loading', 'error'].includes(v.phase)) return;
    const size = Math.max(22, Math.min(42, this.visible.width * 0.025));
    const beats = v.manifest?.beats ?? [];
    const previous = beats.findLast(t => t <= v.songTime);
    const pulse = previous === undefined ? 0 : Math.max(0, 1 - (v.songTime - previous) / 0.22);
    for (const player of [0, 1] as const) {
      const level = v.levels[player]; if (!level) continue;
      const color = PLAYER_COLORS[player]; const grid = v.grids[player];
      if (v.phase !== 'results') {
        for (let cell = 0; cell < 9; cell++) this.outline(this.rect(cellRect(grid, cell)), `${color}70`, 1.5);
        this.outline(this.rect(grid), `${color}${Math.round(70 + pulse * 130).toString(16).padStart(2, '0')}`, 2 + pulse * 3);
      }
      if (v.phase === 'play') {
        const visible = v.states[player].filter(s => !s.result && v.songTime >= s.cue.timeSec - C.approach[level] && v.songTime <= s.cue.timeSec + C.windows[level].good[1] / 1000);
        visible.sort((a, b) => Math.abs(b.cue.timeSec - v.songTime) - Math.abs(a.cue.timeSec - v.songTime));
        visible.forEach((state, index) => {
          const nearest = index === visible.length - 1; const t = Math.max(0, Math.min(1, (state.cue.timeSec - v.songTime) / C.approach[level]));
          state.cue.cells.forEach(cell => {
            const r = this.rect(cellRect(grid, cell));
            this.outline(r, color, nearest ? 4 : 2, `${color}${nearest ? '50' : '22'}`);
            const scale = 1 + 1.2 * t;
            c.save(); c.globalAlpha = nearest ? 0.9 : 0.35;
            this.outline({ x: r.x - r.width * (scale - 1) / 2, y: r.y - r.height * (scale - 1) / 2, width: r.width * scale, height: r.height * scale }, color, 4);
            c.restore();
            if (state.cue.gesture) this.text(GESTURE_EMOJI[state.cue.gesture] ?? '✋', r.x + r.width / 2, r.y + r.height / 2, Math.min(r.width, r.height) * 0.5);
            else { c.fillStyle = color; c.beginPath(); c.arc(r.x + r.width / 2, r.y + r.height / 2, Math.max(5, size * 0.18), 0, Math.PI * 2); c.fill(); }
          });
        });
      }
      if (v.phase === 'ready' || v.phase === 'results') {
        const target = this.rect(cellRect(grid, 1));
        this.outline(target, color, 4, `${color}35`);
        const x = target.x + target.width / 2; const y = target.y + target.height / 2;
        const radius = Math.min(target.width, target.height) * 0.32;
        c.strokeStyle = color; c.lineWidth = 10; c.beginPath(); c.arc(x, y, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * v.hold[player]); c.stroke();
        this.text('✋', x, y, radius * 1.25);
      }
      if (v.phase !== 'results') {
        const g = this.rect(grid); const s = v.scores[player];
        this.text(`P${player + 1} · LEVEL ${level}`, g.x + g.width / 2, Math.max(size * 0.65, g.y - size * 1.75), size * 0.65, color);
        if (v.phase === 'play') {
          this.text(Math.round(s.score).toLocaleString(), g.x + g.width * 0.28, Math.max(size * 1.5, g.y - size * 0.75), size, '#fff');
          this.text(`${s.combo} COMBO`, g.x + g.width * 0.75, Math.max(size * 1.5, g.y - size * 0.75), size * 0.72, color);
        }
      }
      const stale = !v.frame || performance.now() - v.frame.timeMs > 500;
      if (!stale) for (const hand of v.frame!.players[player].hands) {
        const x = this.visible.x + hand.x * this.visible.width; const y = this.visible.y + hand.y * this.visible.height;
        c.strokeStyle = color; c.lineWidth = 5; c.shadowColor = color; c.shadowBlur = 14;
        c.beginPath(); c.arc(x, y, Math.max(13, this.visible.height * 0.025), 0, Math.PI * 2); c.stroke(); c.shadowBlur = 0;
        if (level === 3) this.text(GESTURE_EMOJI[hand.gesture] ?? '', x + size, y, size * 0.7);
      }
    }
    for (const f of v.feedback) {
      const age = (performance.now() - f.at) / 1000; if (age > C.feedbackSec) continue;
      const center = cellCentre(v.grids[f.player], f.cell); const r = this.rect(cellRect(v.grids[f.player], f.cell));
      const color = f.result === 'perfect' ? '#fde047' : f.result === 'good' ? '#86efac' : '#fb5c76';
      c.save(); c.globalAlpha = Math.max(0, 1 - age / C.feedbackSec);
      if (f.result === 'miss') this.outline(r, color, 5, '#fb5c7655');
      if (f.result === 'perfect') {
        const x = this.visible.x + center.x * this.visible.width; const y = this.visible.y + center.y * this.visible.height;
        for (let i = 0; i < 12; i++) { const angle = i * Math.PI / 6; const distance = 15 + age * 140; c.fillStyle = color; c.beginPath(); c.arc(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance, 5 * (1 - age), 0, Math.PI * 2); c.fill(); }
      }
      this.text(f.result.toUpperCase(), r.x + r.width / 2, r.y + r.height / 2 - age * 30, size * 0.85, color); c.restore();
    }
    if (v.phase === 'play') {
      c.fillStyle = '#ffffff26'; c.fillRect(0, 0, this.width, 8);
      c.fillStyle = '#fde047'; c.fillRect(0, 0, this.width * Math.max(0, Math.min(1, v.songTime / v.end)), 8);
      this.text('SPACE pause   ·   R restart   ·   ESC menu', this.width / 2, this.height - size * 0.7, size * 0.48, '#e2e8f0');
    }
  }
}
