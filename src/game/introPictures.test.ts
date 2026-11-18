import { describe, expect, it } from 'vitest';
import { HOLD_CELL_LABELS, PLAYER_COLORS } from './config';
import { BEAT_CELLS, beatPicture, readyPicture, standPicture } from './introPictures';

/** Every match of `pattern` in `text`, by its first group. */
const all = (text: string, pattern: RegExp): string[] => [...text.matchAll(pattern)].map((match) => match[1]);

/** The numbers of an attribute, for every element that has it. */
const numbers = (text: string, attribute: string): number[] =>
  all(text, new RegExp(`\\b${attribute}="([-\\d.]+)"`, 'g')).map(Number);

describe('the beat picture of card 1', () => {
  const picture = beatPicture();

  it('draws a player\'s grid: nine cells and the grid around them, in player 1\'s colour', () => {
    expect(picture.match(/class="pic-cell"/g)).toHaveLength(9);
    expect(picture.match(/class="pic-grid"/g)).toHaveLength(1);
    expect(picture).toContain(`--player: ${PLAYER_COLORS[0]}`);
  });

  it('grows a block in each of three cells in turn, each turn a third of the loop later', () => {
    expect(BEAT_CELLS).toHaveLength(3);
    expect(picture.match(/class="pic-block"/g)).toHaveLength(3);
    expect(all(picture, /class="pic-cue" style="--delay: (-?[\d.]+)s"/g).map(Number)).toEqual([0, -4, -2]);
    expect(picture).toContain('--loop: 6s');
  });

  it('shows "PERFECT" for each cue, as the game writes it, and one hand that visits each cell', () => {
    expect(picture.match(/>PERFECT</g)).toHaveLength(3);
    expect(picture.match(/>✋</g)).toHaveLength(1);
    expect(picture).toMatch(/--a-x: 50px; --a-y: 74px; --b-x: 250px; --b-y: 174px; --c-x: 150px; --c-y: 274px;/);
  });

  it('writes "PERFECT" in its cell, near the middle as the game does, and above the hand', () => {
    const words = [...picture.matchAll(/x="([\d.]+)" y="([\d.]+)" font-size="([\d.]+)"[^>]*>PERFECT</g)];
    const hands = [...picture.matchAll(/--[abc]-y: ([\d.]+)px/g)].map((match) => Number(match[1]));
    BEAT_CELLS.forEach((cell, turn) => {
      const top = Math.floor(cell / 3) * 100;
      const [x, y, size] = words[turn].slice(1).map(Number);
      expect(x).toBe((cell % 3) * 100 + 50);
      expect(y - size / 2).toBeGreaterThan(top);
      expect(y).toBeLessThan(top + 50);
      // The hand sign starts under the word, and ends inside the cell.
      expect(hands[turn] - 22).toBeGreaterThanOrEqual(y + size / 2);
      expect(hands[turn] + 22).toBeLessThanOrEqual(top + 100);
    });
  });

  it('stands still on the first cue, full, with the hand in it, where motion is off', () => {
    // Only the first cue and its "Perfect!" are seen without the keyframes.
    const unseen = picture.match(/opacity="0"/g) ?? [];
    expect(unseen).toHaveLength(4);
    expect(picture).toMatch(/<g class="pic-cue" style="--delay: 0s">/);
  });
});

describe('the stand picture of card 2', () => {
  it('shows one figure in one grid, in player 1\'s colour, for 1 player', () => {
    const picture = standPicture(1);
    expect(picture.match(/class="pic-figure"/g)).toHaveLength(1);
    expect(picture.match(/class="pic-grid"/g)).toHaveLength(1);
    expect(picture).toContain(`class="pic-player" style="--player: ${PLAYER_COLORS[0]}"`);
    expect(picture).not.toContain(PLAYER_COLORS[1]);
  });

  it('shows two figures side by side for 2 players, each in their own half and colour', () => {
    const picture = standPicture(2);
    expect(picture.match(/class="pic-figure"/g)).toHaveLength(2);
    expect(picture).toContain(`class="pic-player" style="--player: ${PLAYER_COLORS[0]}"`);
    expect(picture).toContain(`class="pic-player" style="--player: ${PLAYER_COLORS[1]}"`);
    // The screen's middle is at x 180: the left grid ends before it, the right one starts after it.
    const grids = [...picture.matchAll(/class="pic-grid" x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/g)];
    const [left, right] = grids.map((match) => ({ x: Number(match[1]), width: Number(match[2]) }));
    expect(left.x + left.width).toBeLessThan(180);
    expect(right.x).toBeGreaterThan(180);
  });

  it('raises both arms of each figure, with a ring at each hand', () => {
    expect(standPicture(1).match(/class="pic-palm"/g)).toHaveLength(2);
    expect(standPicture(2).match(/class="pic-palm"/g)).toHaveLength(4);
  });
});

describe('the ready picture of card 3', () => {
  const picture = readyPicture();
  const textX = (content: string): number => {
    const match = picture.match(new RegExp(`x="([\\d.]+)"[^>]*>${content}<`));
    if (!match) throw new Error(`No text ${content}`);
    return Number(match[1]);
  };

  it('shows the Start cell at the top right, with its sign and word', () => {
    const { sign, word } = HOLD_CELL_LABELS.start;
    expect(textX(sign)).toBeGreaterThan(220);
    expect(textX(word)).toBeGreaterThan(220);
    expect(picture.match(/class="pic-start"/g)).toHaveLength(1);
  });

  it('shows the Calibrate cell at the top left, dashed and fainter', () => {
    const { sign, word } = HOLD_CELL_LABELS.calibrate;
    expect(textX(sign)).toBeLessThan(110);
    expect(textX(word)).toBeLessThan(110);
    expect(picture).toMatch(/class="pic-calibrate"/);
    expect(picture).toMatch(/<g class="pic-faint">[^]*Calibrate/);
  });

  it('keeps every word inside its cell', () => {
    for (const size of numbers(picture, 'font-size').filter((value) => value < 30)) {
      expect('Calibrate'.length * 0.62 * size).toBeLessThanOrEqual(110 * 0.9);
    }
  });

  it('fills the Start ring in the time a hand must hold, and stands three quarters full without motion', () => {
    expect(picture).toContain('--ring-loop: 2s');
    const [length] = numbers(picture, 'stroke-dasharray');
    const [offset] = numbers(picture, 'stroke-dashoffset');
    expect(offset / length).toBeCloseTo(0.25, 2);
  });
});
