import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GESTURE_EMOJI } from './config';
import { cellRect } from './geometry';
import { newCueState } from './judgment';
import { createPlayers } from './player';
import type { PlayerRun } from './player';
import { GameRenderer } from './render';
import type { RenderView } from './render';
import { defaultSettings } from './settings';
import type { Cue } from './types';

/** The canvas is 1000 by 750 pixels, the shape of the camera picture: the picture fills it. */
const WIDTH = 1000;
const HEIGHT = 750;
const VIDEO_ASPECT = WIDTH / HEIGHT;

/** A text that the renderer drew: what, and where. */
interface Drawn {
  text: string;
  x: number;
  y: number;
}

/**
 * A 2D context that does nothing but note each text it draws. Every other method is a no-op,
 * and a property keeps what the renderer sets.
 */
function recordingContext(drawn: Drawn[]): CanvasRenderingContext2D {
  const values = new Map<PropertyKey, unknown>();
  const noOp = (): void => {};
  return new Proxy({} as CanvasRenderingContext2D, {
    get: (_, name) => {
      if (name === 'fillText') return (text: string, x: number, y: number) => drawn.push({ text, x, y });
      return values.has(name) ? values.get(name) : noOp;
    },
    set: (_, name, value) => {
      values.set(name, value);
      return true;
    },
  });
}

/** A renderer on a canvas that notes each text it draws. */
function recordingRenderer(): { renderer: GameRenderer; drawn: Drawn[] } {
  const drawn: Drawn[] = [];
  const ctx = recordingContext(drawn);
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: WIDTH, height: HEIGHT }),
  } as unknown as HTMLCanvasElement;
  return { renderer: new GameRenderer(canvas), drawn };
}

/** One player at level 5 with these cues, none judged yet. */
function playerWith(cues: Cue[]): PlayerRun {
  const [player] = createPlayers({ ...defaultSettings(), playerCount: 1, levels: [5, 5] });
  return { ...player, cues, states: cues.map(newCueState) };
}

/** The view of a round in play at `songTimeSec`. */
function playView(player: PlayerRun, songTimeSec: number): RenderView {
  return { phase: 'play', players: [player], songTimeSec, startSec: 0, endSec: 100, feedback: [] };
}

/** The hand-shape signs that the renderer drew, in the order it drew them, with the cell each one is in. */
function signsDrawn(drawn: Drawn[], player: PlayerRun): Array<{ sign: string; cell: number }> {
  const signs = new Set(Object.values(GESTURE_EMOJI));
  return drawn.filter((text) => signs.has(text.text)).map((text) => ({ sign: text.text, cell: cellAt(player, text) }));
}

/** The cell of the player's grid that holds a point on the canvas, or -1. */
function cellAt(player: PlayerRun, point: { x: number; y: number }): number {
  for (let cell = 0; cell < 9; cell++) {
    const rect = cellRect(player.grid, cell);
    const insideX = point.x >= rect.x * WIDTH && point.x <= (rect.x + rect.width) * WIDTH;
    const insideY = point.y >= rect.y * HEIGHT && point.y <= (rect.y + rect.height) * HEIGHT;
    if (insideX && insideY) return cell;
  }
  return -1;
}

describe('the hand shapes that the renderer draws', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('draw the shape of each cell in that cell: two different signs for one tap for two hands', () => {
    const player = playerWith([{ timeSec: 2, beatIndex: 4, cells: [0, 2], shapes: ['fist', 'peace'] }]);
    const { renderer, drawn } = recordingRenderer();
    renderer.draw(playView(player, 1.5), VIDEO_ASPECT);
    expect(signsDrawn(drawn, player)).toEqual([
      { sign: GESTURE_EMOJI.fist, cell: 0 },
      { sign: GESTURE_EMOJI.peace, cell: 2 },
    ]);
  });

  it('draw the signs of cues that overlap in one cell with the cue that is due first on top', () => {
    const player = playerWith([
      { timeSec: 2, beatIndex: 4, cells: [0, 2], shapes: ['fist', 'peace'] },
      { timeSec: 2.5, beatIndex: 5, cells: [0, 5], shapes: ['point', 'open'] },
    ]);
    const { renderer, drawn } = recordingRenderer();
    // Both cues are on screen: a cue shows from 1 s before it is due at level 5.
    renderer.draw(playView(player, 1.8), VIDEO_ASPECT);
    // The later cue comes first, so the cue due first lies on top in cell 0.
    expect(signsDrawn(drawn, player)).toEqual([
      { sign: GESTURE_EMOJI.point, cell: 0 },
      { sign: GESTURE_EMOJI.open, cell: 5 },
      { sign: GESTURE_EMOJI.fist, cell: 0 },
      { sign: GESTURE_EMOJI.peace, cell: 2 },
    ]);
  });

  it('draw no sign for a cue with no shape', () => {
    const player = playerWith([{ timeSec: 2, beatIndex: 4, cells: [0, 2] }]);
    const { renderer, drawn } = recordingRenderer();
    renderer.draw(playView(player, 1.5), VIDEO_ASPECT);
    expect(signsDrawn(drawn, player)).toEqual([]);
  });
});
