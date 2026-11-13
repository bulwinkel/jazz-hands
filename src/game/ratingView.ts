import { SET_RATINGS } from './cueSetRating';
import type { SetRating } from './cueSetRating';
import { find } from './dom';
import type { PlayerIndex } from './types';

/**
 * The rating row of a result card: a label and 5 star buttons, with which a player rates the
 * round's cue set. A fist held on a star chooses it, and so does a click. A choice lights that
 * star and every star below it, and it stays until the next choice. A star under an open hand
 * or the mouse pointer shows, lighter, what choosing it would light.
 *
 * The card shows the score's 5 yellow stars at its top. These stars must not read as those:
 * they are larger, an outline or a fill in the player's colour, and the label names them.
 */

/** How a star looks: lit by the choice, lit lighter by a preview, or an outline. */
export type StarLook = 'lit' | 'preview' | 'off';

/** Hears a player's choice, and answers whether it was saved. */
export type RateHandler = (player: PlayerIndex, rating: SetRating) => Promise<boolean>;

/** The rating rows of the open results. */
export interface RatingRows {
  /** Shows the preview of the star that a hand is on. `hoveredId` is the id of the hand's item, or null. */
  showHandOn(hoveredId: string | null): void;
}

const LABEL = 'Rate the moves';
const NOT_SAVED = 'Not saved';

/** A five-pointed star. The stylesheet draws its outline and its fill. */
const STAR_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.0 2.3 L14.6 9.3 L22.1 9.6 L16.3 14.3 L18.2 21.5 L12.0 17.4 L5.8 21.5 L7.7 14.3 L1.9 9.6 L9.4 9.3Z"/></svg>`;

/**
 * How each star looks, from the first star up. A choice lights its star and the stars below
 * it. A preview shows, lighter, what choosing its star would light, in place of the choice.
 * A preview of the chosen star shows the choice itself: the hand that has just chosen a star
 * is still on it, and must see the choice.
 */
export function starLooks(chosen: SetRating | null, previewed: SetRating | null): StarLook[] {
  const showsPreview = previewed !== null && previewed !== chosen;
  const reach = showsPreview ? previewed : (chosen ?? 0);
  const look: StarLook = showsPreview ? 'preview' : 'lit';
  return SET_RATINGS.map((star) => (star <= reach ? look : 'off'));
}

/** The id by which a hand chooses a star, for example `rate-0-3`. */
export function starId(player: PlayerIndex, star: SetRating): string {
  return `rate-${player}-${star}`;
}

/** The player and the star of an item id. Null for any other item, and for no item. */
export function starOfId(id: string | null): { player: PlayerIndex; star: SetRating } | null {
  const match = /^rate-([01])-([1-5])$/.exec(id ?? '');
  if (!match) return null;
  return { player: Number(match[1]) as PlayerIndex, star: Number(match[2]) as SetRating };
}

/** A count of stars, for example "1 star" or "4 stars". */
function starsText(star: SetRating): string {
  return star === 1 ? '1 star' : `${star} stars`;
}

/** The rating row of one player, with no star lit. */
export function ratingRowHtml(player: PlayerIndex): string {
  const stars = SET_RATINGS.map(
    (star) =>
      `<button type="button" class="rating-star" data-hand="${starId(player, star)}" data-look="off"
        aria-label="${starsText(star)}" aria-pressed="false">${STAR_SVG}</button>`,
  );
  return `
    <div class="rating" data-player="${player}" role="group" aria-label="Player ${player + 1}: ${LABEL}">
      <p class="rating-label">${LABEL}<span class="rating-note" role="status" hidden> · ${NOT_SAVED}</span></p>
      <div class="rating-stars">${stars.join('')}</div>
    </div>`;
}

/** Makes the rating rows inside `root` work. Each choice goes to `onRate`. */
export function buildRatingRows(root: ParentNode, onRate: RateHandler): RatingRows {
  const rows = [...root.querySelectorAll<HTMLElement>('.rating')].map((element) => new RatingRow(element, onRate));
  return {
    showHandOn(hoveredId) {
      const on = starOfId(hoveredId);
      for (const row of rows) row.showHandOn(on?.player === row.player ? on.star : null);
    },
  };
}

/** One player's row: their choice, the previews of the mouse and of a hand, and the saved note. */
class RatingRow {
  readonly player: PlayerIndex;
  private readonly stars: HTMLButtonElement[];
  private readonly note: HTMLElement;
  private readonly onRate: RateHandler;
  private chosen: SetRating | null = null;
  private mouseOn: SetRating | null = null;
  private handOn: SetRating | null = null;
  /** Counts the choices. Only the save of the latest choice may show or hide the note. */
  private choices = 0;

  constructor(element: HTMLElement, onRate: RateHandler) {
    this.player = Number(element.dataset.player) as PlayerIndex;
    this.stars = [...element.querySelectorAll<HTMLButtonElement>('.rating-star')];
    this.note = find(element, '.rating-note');
    this.onRate = onRate;
    this.stars.forEach((button, i) => this.listen(button, SET_RATINGS[i]));
    // The stars touch, so the pointer leaves the row only when it leaves every star.
    find(element, '.rating-stars').addEventListener('pointerleave', () => this.showMouseOn(null));
  }

  /** Runs on every tracking frame: it touches the page only when the star changes. */
  showHandOn(star: SetRating | null): void {
    if (star === this.handOn) return;
    this.handOn = star;
    this.draw();
  }

  private listen(button: HTMLButtonElement, star: SetRating): void {
    button.addEventListener('click', () => this.choose(star));
    button.addEventListener('pointerenter', () => this.showMouseOn(star));
  }

  private showMouseOn(star: SetRating | null): void {
    this.mouseOn = star;
    this.draw();
  }

  /** The last choice counts. Its stars light at once; the note shows only if its save fails. */
  private choose(star: SetRating): void {
    this.chosen = star;
    this.note.hidden = true;
    this.draw();
    this.choices++;
    const choice = this.choices;
    void this.onRate(this.player, star).then((saved) => {
      if (choice === this.choices) this.note.hidden = saved;
    });
  }

  /** The mouse pointer is on the screen itself, so its preview wins over a hand's. */
  private draw(): void {
    const looks = starLooks(this.chosen, this.mouseOn ?? this.handOn);
    this.stars.forEach((button, i) => {
      button.dataset.look = looks[i];
      button.setAttribute('aria-pressed', String(SET_RATINGS[i] === this.chosen));
    });
  }
}
