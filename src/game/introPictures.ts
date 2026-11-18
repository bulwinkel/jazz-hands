import { CALIBRATE_CELL, HOLD_CELL_LABELS, PLAYER_COLORS, START_CELL, TIMING } from './config';
import { cellRect, defaultGrid } from './geometry';
import { holdCellLayout } from './holdCellLayout';
import type { PlayerCount, PlayerIndex, Point, Rect } from './types';

/**
 * The pictures of the "How to play" intro, as inline SVG. They copy how the game draws a grid,
 * a cue and the cells of the ready screen (see render.ts), so a new player knows them in the
 * round. The stylesheet colours and moves them: each picture sets `--player` to a player's
 * colour, and the game hands the cue's start colour and the block's start size to the page
 * (see `GameUI`). Without motion, each picture stands still on a frame that shows its idea.
 */

/** A number for SVG markup: one decimal is enough for a picture. */
const n = (value: number): string => String(Math.round(value * 10) / 10);

/** The corners of a cell or a grid, as the game rounds them (see `outline` in render.ts). */
const cornerRadius = (rect: Rect): number => Math.min(16, rect.width * 0.12);

/** A rounded rectangle with a class. `extra` adds attributes. */
function box(rect: Rect, className: string, extra = ''): string {
  const { x, y, width, height } = rect;
  const rx = n(cornerRadius(rect));
  return `<rect class="${className}" x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}" rx="${rx}"${extra}/>`;
}

const centreOf = (rect: Rect): Point => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

/** A sign or a word, with its middle on the point. */
function label(text: string, at: Point, size: number, className: string, extra = ''): string {
  return `<text class="${className}" x="${n(at.x)}" y="${n(at.y)}" font-size="${n(size)}"${extra}>${text}</text>`;
}

/** A player's grid as the game draws it: a thin outline for each cell, and one around the grid. */
function gridLines(grid: Rect, skip: readonly number[] = []): string {
  const cells = [0, 1, 2, 3, 4, 5, 6, 7, 8]
    .filter((cell) => !skip.includes(cell))
    .map((cell) => box(cellRect(grid, cell), 'pic-cell'));
  return `${cells.join('')}${box(grid, 'pic-grid')}`;
}

/** Opens a picture: a scalable SVG in one player's colour, which assistive tech skips: the card's text says it all. */
function svg(viewBox: string, className: string, player: PlayerIndex, content: string, style = ''): string {
  return `<svg class="${className}" viewBox="${viewBox}" aria-hidden="true" focusable="false"
    style="--player: ${PLAYER_COLORS[player]};${style}">${content}</svg>`;
}

// --- Card 1: a cue, a hand and a Perfect ---

/** The cell size of the beat picture, in its own units. */
const BEAT_CELL = 100;
const BEAT_GRID: Rect = { x: 0, y: 0, width: BEAT_CELL * 3, height: BEAT_CELL * 3 };
/**
 * The cells of the loop, in order: top left, middle right, bottom middle. The stylesheet's
 * keyframes give each cue a third of the loop, so the loop has three cells.
 */
export const BEAT_CELLS = [0, 5, 7] as const;
/** Each cue of the loop takes this long: its block grows, it fills its cell, and "Perfect!" shows. */
export const BEAT_STEP_SEC = 2;
/** The hand sign: a little smaller than half a cell, so it keeps room around it on every device. */
const HAND_SIZE = 44;
const PERFECT_SIZE = 24;

/**
 * Each cue of the loop runs the same keyframes, a turn later than the one before. A negative
 * delay starts it part-way, so it waits for its turn unseen, and the loop has no gap at its start.
 */
function turnDelaySec(turn: number): number {
  const turns = BEAT_CELLS.length;
  return -(((turns - turn) % turns) * BEAT_STEP_SEC);
}

/**
 * Card 1, animated: a block grows in one cell of a 3 by 3 grid, white at first and the player's
 * colour when it fills the cell, as a cue does. A hand moves into the cell as the block fills,
 * and "Perfect!" pops above the cell when it is full. Then the same in the next cell. Without
 * motion, it shows the first cue full, with the hand in it.
 */
export function beatPicture(): string {
  const cues = BEAT_CELLS.map((cell, turn) => {
    const rect = cellRect(BEAT_GRID, cell);
    // Only the first cue shows in the still frame. The keyframes show each one in its turn.
    const unseen = turn === 0 ? '' : ' opacity="0"';
    return `<g class="pic-cue" style="--delay: ${turnDelaySec(turn)}s"${unseen}>
      ${box(rect, 'pic-cue-cell')}${box(rect, 'pic-block')}
    </g>`;
  });
  const perfects = BEAT_CELLS.map((cell, turn) => {
    const rect = cellRect(BEAT_GRID, cell);
    const at = { x: rect.x + rect.width / 2, y: rect.y - 8 };
    const unseen = turn === 0 ? '' : ' opacity="0"';
    return label('Perfect!', at, PERFECT_SIZE, 'pic-perfect', ` style="--delay: ${turnDelaySec(turn)}s"${unseen}`);
  });
  // The hand's three stops, one in each cell of the loop, for the stylesheet's keyframes.
  const stops = BEAT_CELLS.map((cell, turn) => {
    const centre = centreOf(cellRect(BEAT_GRID, cell));
    const name = 'abc'[turn];
    return `--${name}-x: ${n(centre.x)}px; --${name}-y: ${n(centre.y)}px;`;
  });
  const hand = `<g class="pic-hand" style="${stops.join(' ')}">${label('✋', { x: 0, y: 0 }, HAND_SIZE, 'pic-sign')}</g>`;
  const loop = `--loop: ${BEAT_CELLS.length * BEAT_STEP_SEC}s`;
  return svg('-22 -44 344 350', 'pic-beat', 0, `${gridLines(BEAT_GRID)}${cues.join('')}${hand}${perfects.join('')}`, loop);
}

// --- Card 2: where to stand ---

/** The screen of the stand picture, 16:9, in its own units. Its picture is the camera frame. */
const SCREEN: Rect = { x: 12, y: 12, width: 336, height: 189 };

/** A rectangle of the camera frame, in fractions, on the picture's screen. */
function onScreen(rect: Rect): Rect {
  return {
    x: SCREEN.x + rect.x * SCREEN.width,
    y: SCREEN.y + rect.y * SCREEN.height,
    width: rect.width * SCREEN.width,
    height: rect.height * SCREEN.height,
  };
}

/**
 * A simple figure inside its grid: the head in the top middle cell, the body down the middle,
 * and both arms raised at full stretch, with a hand in each top corner cell. A ring in the
 * player's colour marks each hand, as the game marks each palm it sees.
 */
function figure(grid: Rect): string {
  const cellWidth = grid.width / 3;
  const cellHeight = grid.height / 3;
  const size = Math.min(cellWidth, cellHeight);
  const centreX = grid.x + grid.width / 2;
  const head = { x: centreX, y: grid.y + cellHeight * 0.62, radius: size * 0.3 };
  const neckY = head.y + head.radius;
  const shoulderY = neckY + cellHeight * 0.18;
  const hipY = grid.y + cellHeight * 2.05;
  const footY = grid.y + cellHeight * 2.92;
  const handY = grid.y + cellHeight * 0.45;
  const hands = [grid.x + cellWidth * 0.5, grid.x + cellWidth * 2.5];
  const shoulders = [centreX - cellWidth * 0.28, centreX + cellWidth * 0.28];
  const line = (from: Point, to: Point): string =>
    `<line x1="${n(from.x)}" y1="${n(from.y)}" x2="${n(to.x)}" y2="${n(to.y)}"/>`;
  const limbs = [
    line({ x: centreX, y: neckY }, { x: centreX, y: hipY }),
    line({ x: centreX, y: hipY }, { x: centreX - cellWidth * 0.38, y: footY }),
    line({ x: centreX, y: hipY }, { x: centreX + cellWidth * 0.38, y: footY }),
    ...hands.map((handX, side) => line({ x: shoulders[side], y: shoulderY }, { x: handX, y: handY })),
  ];
  const palms = hands.map(
    (handX) => `<circle class="pic-palm" cx="${n(handX)}" cy="${n(handY)}" r="${n(size * 0.15)}"/>`,
  );
  return `<g class="pic-figure" stroke-width="${n(size * 0.11)}">
      <circle cx="${n(head.x)}" cy="${n(head.y)}" r="${n(head.radius)}"/>${limbs.join('')}
    </g>${palms.join('')}`;
}

/**
 * Card 2: a screen with a figure in a grid, as the camera sees a player who stands far
 * enough back. With 2 players, two figures side by side, each with the standard grid of their
 * own half and in their own colour. It follows the player choice of the card.
 */
export function standPicture(playerCount: PlayerCount): string {
  const players: PlayerIndex[] = playerCount === 1 ? [0] : [0, 1];
  const dancers = players.map((player) => {
    const grid = onScreen(defaultGrid(player, playerCount));
    return `<g class="pic-player" style="--player: ${PLAYER_COLORS[player]}">${gridLines(grid)}${figure(grid)}</g>`;
  });
  const screen = `
    <rect class="pic-bezel" x="4" y="4" width="352" height="205" rx="12"/>
    <rect class="pic-screen" x="${SCREEN.x}" y="${SCREEN.y}" width="${SCREEN.width}" height="${SCREEN.height}" rx="4"/>
    <rect class="pic-bezel" x="172" y="209" width="16" height="14"/>
    <rect class="pic-bezel" x="126" y="222" width="108" height="9" rx="4.5"/>`;
  return svg('0 0 360 235', 'pic-stand', 0, `${screen}${dancers.join('')}`);
}

// --- Card 3: the cells of the ready screen ---

const READY_CELL = 110;
const READY_GRID: Rect = { x: 0, y: 0, width: READY_CELL * 3, height: READY_CELL * 3 };
/** The size of a word in a cell, in the picture's units. It reads at the picture's size. */
const READY_WORD_SIZE = 17;
/** A guess of a word's width, as a share of its size per letter: wide enough for a bold system font. */
const LETTER_WIDTH = 0.62;
/** The ring line of the Start cell. */
const START_RING_WIDTH = 6;
/** The share of the Start ring that is full in the still frame. */
const STILL_RING_SHARE = 0.75;

/** Lays out a Start or Calibrate cell of the picture as the game does (see holdCellLayout.ts). */
function cellLayout(cell: Rect, word: string) {
  const wordWidth = word.length * LETTER_WIDTH * READY_WORD_SIZE;
  return holdCellLayout(cell, READY_WORD_SIZE, wordWidth, Number.POSITIVE_INFINITY);
}

/** A ring that fills clockwise from the top. `filled` is the share full in the still frame. */
function holdRing(centre: Point, radius: number, lineWidth: number, className: string, filled: number): string {
  const length = 2 * Math.PI * radius;
  const offset = length * (1 - filled);
  return `<circle class="${className}" cx="${n(centre.x)}" cy="${n(centre.y)}" r="${n(radius)}"
    stroke-width="${lineWidth}" stroke-dasharray="${n(length)}" stroke-dashoffset="${n(offset)}"
    transform="rotate(-90 ${n(centre.x)} ${n(centre.y)})" style="--ring: ${n(length)}px"/>`;
}

/** The Start cell: a bold outline, a ring that fills while a hand holds, the sign and the word. */
function startCell(): string {
  const cell = cellRect(READY_GRID, START_CELL);
  const { sign, word } = HOLD_CELL_LABELS.start;
  const layout = cellLayout(cell, word);
  const wordLabel = layout.word ? label(word, layout.word, layout.word.size, 'pic-word') : '';
  return `${box(cell, 'pic-start')}
    ${holdRing(layout.centre, layout.radius, START_RING_WIDTH, 'pic-ring', STILL_RING_SHARE)}
    ${label(sign, layout.centre, layout.radius * 1.25, 'pic-sign')}${wordLabel}`;
}

/**
 * The Calibrate cell: a thin dashed outline, and a fainter sign and word. Its ring shows only
 * while a hand holds the cell, so the picture has none.
 */
function calibrateCell(): string {
  const cell = cellRect(READY_GRID, CALIBRATE_CELL);
  const { sign, word } = HOLD_CELL_LABELS.calibrate;
  const layout = cellLayout(cell, word);
  const wordLabel = layout.word ? label(word, layout.word, layout.word.size, 'pic-word') : '';
  return `${box(cell, 'pic-calibrate')}
    <g class="pic-faint">${label(sign, layout.centre, layout.radius * 1.1, 'pic-sign')}${wordLabel}</g>`;
}

/**
 * Card 3: one grid as the ready screen draws it, with the Start cell at the top right and the
 * Calibrate cell at the top left. The Start ring fills in the time a hand must hold, then
 * starts again. Without motion, it stands three quarters full.
 */
export function readyPicture(): string {
  const loop = `--ring-loop: ${TIMING.readyHoldSec * 2}s`;
  const content = `${gridLines(READY_GRID, [START_CELL, CALIBRATE_CELL])}${calibrateCell()}${startCell()}`;
  return svg('-6 -6 342 342', 'pic-ready', 0, content, loop);
}
