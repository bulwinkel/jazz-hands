import { carouselOffset, stepRing } from './carousel';
import { HAND_MENU, LEVELS, PLAYER_COLORS, SONGS } from './config';
import { nextCueSetChoice } from './cueSet';
import { find, isHandClick } from './dom';
import type { Settings } from './settings';
import type { Level, PlayerCount, PlayerIndex, SongLength } from './types';

const ALL_LEVELS: Level[] = [1, 2, 3, 4, 5];
/**
 * The song carousel shows this many cards on each side of the chosen song. The stylesheet
 * assumes 2: it has a `.song-card[data-offset="…"]` rule for each offset from -3 to 3, the
 * cards on show and the place where the cards out of sight wait. Another reach needs rules
 * for its own offsets.
 */
const CAROUSEL_REACH = 2;

/**
 * The arrow on a step button, drawn as a picture. A "‹" letter does not sit in the middle of
 * its own line, so it looked low in the button.
 */
const chevron = (points: string): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="${points}" /></svg>`;
const CHEVRON_LEFT = chevron('15.5,5 8.5,12 15.5,19');
const CHEVRON_RIGHT = chevron('8.5,5 15.5,12 8.5,19');

/** The menu's content. It scales with the window as one piece. */
export const MENU_HTML = `
  <div class="eyebrow">MOVE TOGETHER · PLAY TOGETHER</div>
  <h1>Jazz Hands<span>✦</span></h1>
  <p class="subtitle">Reach for the beat. Make a little magic.</p>
  <fieldset class="songs">
    <legend>♫ <span id="song-title"></span><small id="song-count"></small></legend>
    <button type="button" class="song-step" data-hand="song-previous" data-hand-repeat aria-label="Previous song">${CHEVRON_LEFT}</button>
    <div class="song-strip"></div>
    <button type="button" class="song-step" data-hand="song-next" data-hand-repeat aria-label="Next song">${CHEVRON_RIGHT}</button>
  </fieldset>
  <fieldset class="count choices">
    <legend>Players</legend>
    <label data-hand="count-1"><input type="radio" name="count" value="1"><span>1 player</span></label>
    <label data-hand="count-2"><input type="radio" name="count" value="2"><span>2 players</span></label>
  </fieldset>
  <div class="players"></div>
  <fieldset class="length choices">
    <legend>How long shall we dance?</legend>
    <label data-hand="length-short"><input type="radio" name="length" value="short"><span>Short · about 90 seconds</span></label>
    <label data-hand="length-full"><input type="radio" name="length" value="full"><span>Full song</span></label>
  </fieldset>
  <button class="primary" id="start" data-hand="start" data-hand-hold="${HAND_MENU.slowHoldSec}">Let’s dance →</button>
  <p class="keys">
    <span id="hand-hint">Point with an open hand ✋, then make a fist ✊ to choose · </span>Space or Enter to start · F fullscreen<br>
    <span id="stand-hint"></span>
    <span id="sound-hint" hidden><br>Click or press a key once, so the browser lets the music play.</span>
  </p>`;

/**
 * Four switches in a top corner of the menu: previews, hand control, recording and the cue
 * set. They are outside the scaled content, a little in from the side: the camera tracks a
 * hand badly at the edge of its picture.
 */
export const MENU_SWITCHES_HTML = `
  <div class="corner">
    <button type="button" id="previews-switch" data-hand="previews"></button>
    <button type="button" id="hands-switch" data-hand="hand-control"></button>
    <button type="button" id="record-switch" data-hand="record"></button>
    <button type="button" id="set-switch" data-hand="cue-set"></button>
  </div>`;

const STAND_HINT: Record<PlayerCount, string> = {
  1: 'Stand in the middle of the picture.',
  2: 'Stand side by side. Each dancer gets one half of the screen.',
};

/** What the menu tells the game. */
export interface MenuHandlers {
  /** Start was chosen. `byHand` says that a pointing hand chose it, and not a mouse or a key. */
  onStart: (byHand: boolean) => void;
  /** A choice changed. The menu has written it into the settings by then. */
  onChange: () => void;
}

/** What the page can do with the menu once it is built. */
export interface MenuControls {
  /** Chooses the next song (1) or the previous one (-1). After the last comes the first. */
  stepSong: (direction: 1 | -1) => void;
  /** Stops what the menu listens to outside its own elements. Call it when the menu goes. */
  close: () => void;
}

/** Ties a group of radio inputs to one value. */
function bindRadios(root: ParentNode, name: string, current: string, onPick: (value: string) => void): void {
  for (const input of root.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)) {
    input.checked = input.value === current;
    input.addEventListener('change', () => {
      if (input.checked) onPick(input.value);
    });
  }
}

/**
 * One song in the carousel: its cover picture. A song with no picture yet gets a plain cover
 * in its own colour, with its title on it.
 */
function songCard(index: number): string {
  const song = SONGS[index];
  // Steps of the golden angle give neighbours in the list clearly different colours.
  const hue = Math.round(index * 137.5) % 360;
  const cover = song.cover
    ? `<span class="cover"><img src="${song.cover}" alt=""></span>`
    : `<span class="cover plain"><span>${song.title}</span></span>`;
  return `
    <label class="song-card" style="--hue: ${hue}">
      <input type="radio" name="song" value="${index}" aria-label="${song.title}">${cover}
    </label>`;
}

/** One player's choices: level, hand shapes and faces. */
function playerCard(player: PlayerIndex, settings: Settings, onChange: () => void): HTMLElement {
  const side = player === 0 ? 'Left' : 'Right';
  const title = settings.playerCount === 1 ? 'Your level' : `Player ${player + 1} · ${side}`;
  const levelOptions = ALL_LEVELS.map(
    (level) => `
      <label data-hand="level-${player}-${level}">
        <input type="radio" name="level${player}" value="${level}">
        <span>Level ${level}<small>${LEVELS[level].name}</small></span>
      </label>`,
  ).join('');

  const card = document.createElement('fieldset');
  card.style.setProperty('--player', PLAYER_COLORS[player]);
  card.innerHTML = `
    <legend>${title}</legend>
    <div class="level-options">${levelOptions}</div>
    <div class="switches">
      <label class="shapes" data-hand="shapes-${player}"><input type="checkbox"><span>Hand shapes ✊ ✋ ☝️ ✌️</span></label>
      <label class="faces" data-hand="faces-${player}"><input type="checkbox"><span>Faces 😁 😲 😘</span></label>
    </div>`;

  const shapes = find<HTMLInputElement>(card, '.shapes input');
  /** A level with a shape on every cue has no use for the switch: it shows as on, and locked. */
  const showShapes = (): void => {
    const always = LEVELS[settings.levels[player]].shapeOnEveryCue;
    shapes.checked = always || settings.shapes[player];
    shapes.disabled = always;
  };
  showShapes();
  bindRadios(card, `level${player}`, String(settings.levels[player]), (value) => {
    settings.levels[player] = Number(value) as Level;
    showShapes();
    onChange();
  });
  shapes.addEventListener('change', () => {
    settings.shapes[player] = shapes.checked;
    onChange();
  });

  const faces = find<HTMLInputElement>(card, '.faces input');
  faces.checked = settings.faces[player];
  faces.addEventListener('change', () => {
    settings.faces[player] = faces.checked;
    onChange();
  });
  return card;
}

/**
 * Builds the menu in `panel`, which holds MENU_HTML and MENU_SWITCHES_HTML. The menu edits
 * `settings` in place and calls `onChange` after each edit.
 */
export function buildMenu(panel: HTMLElement, settings: Settings, handlers: MenuHandlers): MenuControls {
  const { onStart, onChange } = handlers;
  // The menu's listeners on the window end with the menu, also when no click or key came.
  const listening = new AbortController();

  // The switches in the corner. Each shows its state in its text.
  const handHint = find(panel, '#hand-hint');
  type SwitchKey = 'previews' | 'handControl' | 'record';
  const bindSwitch = (id: string, key: SwitchKey, label: string, icons: [string, string]): void => {
    const button = find<HTMLButtonElement>(panel, id);
    const show = (): void => {
      const isOn = settings[key];
      button.textContent = `${isOn ? icons[0] : icons[1]} ${label} ${isOn ? 'on' : 'off'}`;
      button.setAttribute('aria-pressed', String(isOn));
      handHint.hidden = !settings.handControl;
    };
    show();
    button.addEventListener('click', () => {
      settings[key] = !settings[key];
      show();
      onChange();
    });
  };
  bindSwitch('#previews-switch', 'previews', 'Previews', ['🔊', '🔇']);
  bindSwitch('#hands-switch', 'handControl', 'Hand control', ['✋', '🚫']);
  bindSwitch('#record-switch', 'record', 'Recording', ['🔴', '⚪']);
  // The cue set has more than two values: each choice steps to the next one, from random
  // through every set and back to random. Only this switch changes it.
  const setSwitch = find(panel, '#set-switch');
  const showCueSet = (): void => {
    setSwitch.textContent = `🎲 Set: ${settings.cueSet}`;
  };
  showCueSet();
  setSwitch.addEventListener('click', () => {
    settings.cueSet = nextCueSetChoice(settings.cueSet);
    showCueSet();
    onChange();
  });

  // The songs are a carousel of covers: the chosen song in the middle, its neighbours beside
  // it, the rest out of sight. It takes the same room for six songs as for sixty.
  const strip = find(panel, '.song-strip');
  strip.innerHTML = SONGS.map((_, index) => songCard(index)).join('');
  const songCards = [...strip.querySelectorAll<HTMLElement>('.song-card')];
  const showSongs = (): void => {
    songCards.forEach((card, index) => {
      const offset = carouselOffset(index, settings.songIndex, SONGS.length);
      const onShow = Math.abs(offset) <= CAROUSEL_REACH;
      // Every card out of sight waits just past the last card on show, on its own side.
      card.dataset.offset = String(onShow ? offset : Math.sign(offset) * (CAROUSEL_REACH + 1));
      // Only a card on show can be pointed at.
      if (onShow) card.dataset.hand = `song-${index}`;
      else delete card.dataset.hand;
      find<HTMLInputElement>(card, 'input').checked = offset === 0;
    });
    find(panel, '#song-title').textContent = SONGS[settings.songIndex].title;
    find(panel, '#song-count').textContent = `${settings.songIndex + 1} of ${SONGS.length}`;
  };
  showSongs();
  const chooseSong = (index: number): void => {
    if (index === settings.songIndex) return;
    settings.songIndex = index;
    showSongs();
    onChange();
  };
  const stepSong = (direction: 1 | -1): void => chooseSong(stepRing(settings.songIndex, direction, SONGS.length));
  songCards.forEach((card, index) => {
    find(card, 'input').addEventListener('change', () => chooseSong(index));
  });
  find(panel, '[data-hand="song-previous"]').addEventListener('click', () => stepSong(-1));
  find(panel, '[data-hand="song-next"]').addEventListener('click', () => stepSong(1));

  // A round started by hand has no click behind it, and a browser plays sound only on a page
  // that was clicked or typed in at least once. Ask for that one click while it is missing.
  const soundHint = find(panel, '#sound-hint');
  soundHint.hidden = navigator.userActivation?.hasBeenActive ?? true;
  const hideSoundHint = (): void => {
    soundHint.hidden = true;
  };
  window.addEventListener('pointerdown', hideSoundHint, { once: true, signal: listening.signal });
  window.addEventListener('keydown', hideSoundHint, { once: true, signal: listening.signal });

  const cards = find(panel, '.players');
  const standHint = find(panel, '#stand-hint');
  const showPlayers = (): void => {
    const indices: PlayerIndex[] = settings.playerCount === 1 ? [0] : [0, 1];
    cards.replaceChildren(...indices.map((player) => playerCard(player, settings, onChange)));
    cards.classList.toggle('solo', settings.playerCount === 1);
    standHint.textContent = STAND_HINT[settings.playerCount];
  };
  showPlayers();

  bindRadios(panel, 'count', String(settings.playerCount), (value) => {
    settings.playerCount = Number(value) as PlayerCount;
    showPlayers();
    onChange();
  });
  bindRadios(panel, 'length', settings.length, (value) => {
    settings.length = value as SongLength;
    onChange();
  });
  find(panel, '#start').addEventListener('click', (event) => onStart(isHandClick(event)));

  return { stepSong, close: () => listening.abort() };
}
