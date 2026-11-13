import { describe, expect, it } from 'vitest';
import type { SetRating } from './cueSetRating';
import { buildRatingRows, handStarOn, ratingRowHtml, starId, starLooks, starOfId } from './ratingView';
import type { RateHandler } from './ratingView';
import type { PlayerIndex } from './types';

describe('the looks of the stars', () => {
  it('lights no star before a choice', () => {
    expect(starLooks(null, null)).toEqual(['off', 'off', 'off', 'off', 'off']);
  });

  it('lights the chosen star and every star below it, for each choice', () => {
    expect(starLooks(1, null)).toEqual(['lit', 'off', 'off', 'off', 'off']);
    expect(starLooks(2, null)).toEqual(['lit', 'lit', 'off', 'off', 'off']);
    expect(starLooks(3, null)).toEqual(['lit', 'lit', 'lit', 'off', 'off']);
    expect(starLooks(4, null)).toEqual(['lit', 'lit', 'lit', 'lit', 'off']);
    expect(starLooks(5, null)).toEqual(['lit', 'lit', 'lit', 'lit', 'lit']);
  });

  it('previews a star and the stars below it, lighter, before a choice', () => {
    expect(starLooks(null, 3)).toEqual(['preview', 'preview', 'preview', 'off', 'off']);
  });

  it('previews a higher star in place of the choice', () => {
    expect(starLooks(2, 5)).toEqual(['preview', 'preview', 'preview', 'preview', 'preview']);
  });

  it('previews a lower star in place of the choice', () => {
    expect(starLooks(4, 1)).toEqual(['preview', 'off', 'off', 'off', 'off']);
  });

  it('shows the choice itself while the chosen star is previewed', () => {
    expect(starLooks(3, 3)).toEqual(['lit', 'lit', 'lit', 'off', 'off']);
  });
});

describe('the id of a star', () => {
  it('names the player and the star, and reads back', () => {
    expect(starId(1, 4)).toBe('rate-1-4');
    expect(starOfId('rate-1-4')).toEqual({ player: 1, star: 4 });
    expect(starOfId(starId(0, 1))).toEqual({ player: 0, star: 1 });
  });

  it('is no star for the other items and for no item', () => {
    for (const id of ['replay', 'menu', 'rate-2-1', 'rate-0-0', 'rate-0-6', 'rate-0-3x', null]) {
      expect(starOfId(id)).toBeNull();
    }
  });
});

describe('the rating row', () => {
  it('holds the label and 5 stars for the hand, from the first up', () => {
    const html = ratingRowHtml(1);
    expect(html).toContain('Rate the moves');
    const ids = [...html.matchAll(/data-hand="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toEqual(['rate-1-1', 'rate-1-2', 'rate-1-3', 'rate-1-4', 'rate-1-5']);
  });

  it('gives each star the default hold of the hand menu', () => {
    expect(ratingRowHtml(0)).not.toContain('data-hand-hold');
  });

  it('starts with no star lit and the note unseen', () => {
    const html = ratingRowHtml(0);
    expect(html.match(/data-look="off"/g)).toHaveLength(5);
    expect(html).toMatch(/class="rating-note"[^>]*hidden/);
  });
});

describe('the star of a row that a pointer is on', () => {
  it('is the star of that row, and none for the other row', () => {
    const hovers = [{ id: 'rate-1-2', progress: 0.4 }];
    expect(handStarOn(hovers, 1)).toBe(2);
    expect(handStarOn(hovers, 0)).toBeNull();
  });

  it('is the star whose hold is further along, of two pointers on one row', () => {
    const hovers = [
      { id: 'rate-0-2', progress: 0.1 },
      { id: 'rate-0-5', progress: 0.6 },
    ];
    expect(handStarOn(hovers, 0)).toBe(5);
  });

  it('is the first player\'s star when both holds are as far along', () => {
    const hovers = [
      { id: 'rate-0-2', progress: 0 },
      { id: 'rate-0-5', progress: 0 },
    ];
    expect(handStarOn(hovers, 0)).toBe(2);
  });

  it('is none when no pointer is on a star', () => {
    expect(handStarOn([{ id: 'menu', progress: 0.3 }], 0)).toBeNull();
    expect(handStarOn([], 1)).toBeNull();
  });
});

// --- The rows at work, on stand-ins for the page: the tests run without one ---

type Listener = () => void;

class FakeTarget {
  private readonly listeners = new Map<string, Listener[]>();
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  fire(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

class FakeStar extends FakeTarget {
  readonly dataset: Record<string, string> = { look: 'off' };
  readonly attributes: Record<string, string> = {};
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
}

class FakeRow extends FakeTarget {
  readonly dataset: Record<string, string>;
  readonly stars = Array.from({ length: 5 }, () => new FakeStar());
  readonly note = { hidden: true };
  readonly starRow = new FakeTarget();
  constructor(player: PlayerIndex) {
    super();
    this.dataset = { player: String(player) };
  }
  querySelectorAll(): FakeStar[] {
    return this.stars;
  }
  querySelector(selector: string): unknown {
    return selector === '.rating-note' ? this.note : this.starRow;
  }
  looks(): string[] {
    return this.stars.map((star) => star.dataset.look);
  }
}

/** Both players' rows, and every save they asked for, which a test settles. */
function twoRows() {
  const rows = [new FakeRow(0), new FakeRow(1)];
  const saves: Array<{ player: PlayerIndex; rating: SetRating; settle: (saved: boolean) => void }> = [];
  const onRate: RateHandler = (player, rating) =>
    new Promise((settle) => saves.push({ player, rating, settle }));
  const root = { querySelectorAll: () => rows } as unknown as ParentNode;
  return { rows, saves, controls: buildRatingRows(root, onRate) };
}

/** Lets the promises that are settled run their handlers. */
const settled = () => new Promise((done) => setTimeout(done, 0));

describe('the rating rows at work', () => {
  it('saves each click as the player\'s rating, and lights its stars', () => {
    const { rows, saves } = twoRows();
    rows[0].stars[3].fire('click');
    rows[1].stars[1].fire('click');
    expect(saves.map(({ player, rating }) => [player, rating])).toEqual([[0, 4], [1, 2]]);
    expect(rows[0].looks()).toEqual(['lit', 'lit', 'lit', 'lit', 'off']);
    expect(rows[1].looks()).toEqual(['lit', 'lit', 'off', 'off', 'off']);
    expect(rows[0].stars[3].attributes['aria-pressed']).toBe('true');
    expect(rows[0].stars[2].attributes['aria-pressed']).toBe('false');
  });

  it('lets a new choice replace the one before', () => {
    const { rows, saves } = twoRows();
    rows[0].stars[3].fire('click');
    rows[0].stars[4].fire('click');
    expect(saves.map(({ rating }) => rating)).toEqual([4, 5]);
    expect(rows[0].looks()).toEqual(['lit', 'lit', 'lit', 'lit', 'lit']);
  });

  it('previews the star under a pointer, on the row of that star only', () => {
    const { rows, controls } = twoRows();
    controls.showHandsOn([{ id: 'rate-1-3', progress: 0 }]);
    expect(rows[1].looks()).toEqual(['preview', 'preview', 'preview', 'off', 'off']);
    expect(rows[0].looks()).toEqual(['off', 'off', 'off', 'off', 'off']);
    controls.showHandsOn([{ id: 'replay', progress: 0 }]);
    expect(rows[1].looks()).toEqual(['off', 'off', 'off', 'off', 'off']);
  });

  it('previews on both rows at once when two pointers are on two rows', () => {
    const { rows, controls } = twoRows();
    controls.showHandsOn([
      { id: 'rate-0-4', progress: 0.2 },
      { id: 'rate-1-1', progress: 0 },
    ]);
    expect(rows[0].looks()).toEqual(['preview', 'preview', 'preview', 'preview', 'off']);
    expect(rows[1].looks()).toEqual(['preview', 'off', 'off', 'off', 'off']);
  });

  it('previews the star under the mouse pointer until the pointer leaves the stars', () => {
    const { rows } = twoRows();
    rows[0].stars[1].fire('pointerenter');
    expect(rows[0].looks()).toEqual(['preview', 'preview', 'off', 'off', 'off']);
    rows[0].starRow.fire('pointerleave');
    expect(rows[0].looks()).toEqual(['off', 'off', 'off', 'off', 'off']);
  });

  it('shows the choice again when the preview ends', () => {
    const { rows, controls } = twoRows();
    rows[0].stars[2].fire('click');
    controls.showHandsOn([{ id: 'rate-0-5', progress: 0 }]);
    controls.showHandsOn([]);
    expect(rows[0].looks()).toEqual(['lit', 'lit', 'lit', 'off', 'off']);
  });

  it('shows the note when the save fails, and nothing when it works', async () => {
    const { rows, saves } = twoRows();
    rows[0].stars[0].fire('click');
    saves[0].settle(false);
    await settled();
    expect(rows[0].note.hidden).toBe(false);
    rows[0].stars[1].fire('click');
    expect(rows[0].note.hidden).toBe(true);
    saves[1].settle(true);
    await settled();
    expect(rows[0].note.hidden).toBe(true);
  });

  it('lets only the save of the last choice show the note', async () => {
    const { rows, saves } = twoRows();
    rows[0].stars[0].fire('click');
    rows[0].stars[1].fire('click');
    saves[1].settle(true);
    saves[0].settle(false);
    await settled();
    expect(rows[0].note.hidden).toBe(true);
  });
});
