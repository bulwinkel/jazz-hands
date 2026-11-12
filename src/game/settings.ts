import type { TrackerMode } from '../tracking/types';
import { DEFAULT_SEED, SONGS, TIMING } from './config';
import type { Level, PlayerCount, SongLength } from './types';

/** Choices kept between visits. */
export interface Settings {
  playerCount: PlayerCount;
  /** Level of each player. The second entry is unused with one player. */
  levels: [Level, Level];
  /** Whether each player gets hand-shape cues. */
  shapes: [boolean, boolean];
  /** Whether each player gets face cues. */
  faces: [boolean, boolean];
  length: SongLength;
  inputLatencyMs: number;
  avOffsetMs: number;
  songIndex: number;
  /** Whether the menu plays a part of the chosen song. */
  previews: boolean;
  /** Whether a hand can point at the menu and the results and choose there with a fist. */
  handControl: boolean;
  /** Whether each round is recorded as video. */
  record: boolean;
}

export type InputSource = 'camera' | 'mouse' | 'bot';

/** What a page load starts from: the kept settings plus one-off URL parameters. */
export interface Options {
  settings: Settings;
  input: InputSource;
  /** Tracker named in the URL. Unset means the default for the player count. */
  tracker?: TrackerMode;
  /** Start the song this far in and drop earlier cues. */
  startSec: number;
  /** Skip the menu. */
  autostart: boolean;
  seed: number;
  /** Share of cues the test bot plays. */
  botAccuracy: number;
}

export const STORAGE_KEY = 'dance-game-v1';

export function defaultSettings(): Settings {
  return {
    playerCount: 2,
    levels: [2, 1],
    shapes: [false, false],
    faces: [false, false],
    length: 'short',
    inputLatencyMs: TIMING.inputLatencyMs,
    avOffsetMs: TIMING.avOffsetMs,
    songIndex: 0,
    previews: true,
    handControl: true,
    record: false,
  };
}

/** True when a player in the session has faces on. The second switch counts only with two players. */
export function usesFaces(settings: Settings): boolean {
  return settings.faces.slice(0, settings.playerCount).some((isOn) => isOn);
}

const isLevel = (value: unknown): value is Level =>
  value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
const isPlayerCount = (value: unknown): value is PlayerCount => value === 1 || value === 2;
const isLength = (value: unknown): value is SongLength => value === 'short' || value === 'full';
const isSongIndex = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < SONGS.length;
const isTrackerMode = (value: unknown): value is TrackerMode =>
  value === 'hands-full' || value === 'hands-split' || value === 'pose';

function finiteOr(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

/**
 * Reads kept settings field by field. A missing or invalid field keeps its default,
 * so settings saved by an older version of the game never break a newer one.
 */
function readStored(stored: unknown): Settings {
  const settings = defaultSettings();
  if (!stored || typeof stored !== 'object') return settings;
  const saved = stored as Record<string, unknown>;

  if (isPlayerCount(saved.playerCount)) settings.playerCount = saved.playerCount;
  if (isLength(saved.length)) settings.length = saved.length;
  for (const player of [0, 1] as const) {
    const level = Array.isArray(saved.levels) ? saved.levels[player] : undefined;
    const shapes = Array.isArray(saved.shapes) ? saved.shapes[player] : undefined;
    const faces = Array.isArray(saved.faces) ? saved.faces[player] : undefined;
    if (isLevel(level)) settings.levels[player] = level;
    if (typeof shapes === 'boolean') settings.shapes[player] = shapes;
    if (typeof faces === 'boolean') settings.faces[player] = faces;
  }
  if (isSongIndex(saved.songIndex)) settings.songIndex = saved.songIndex;
  if (typeof saved.previews === 'boolean') settings.previews = saved.previews;
  if (typeof saved.handControl === 'boolean') settings.handControl = saved.handControl;
  if (typeof saved.record === 'boolean') settings.record = saved.record;
  settings.inputLatencyMs = finiteOr(saved.inputLatencyMs, settings.inputLatencyMs, -1000, 2000);
  settings.avOffsetMs = finiteOr(saved.avOffsetMs, settings.avOffsetMs, -2000, 2000);
  return settings;
}

/**
 * URL parameters, all optional:
 *   players=1|2   p0, p1=1..5   shapes0, shapes1=1|0   faces0, faces1=1|0
 *   length=short|full   song=<index from 0>   previews=1|0   hands=1|0   record=1|0
 *   tracker=hands-full|hands-split|pose   input=camera|mouse|bot
 *   start=<seconds>   autostart=1   seed=<integer>   botAccuracy=<0..1>
 */
export function parseSettings(stored: unknown, query: string): Options {
  const settings = readStored(stored);
  const params = new URLSearchParams(query);
  const numberParam = (name: string): number | undefined =>
    params.has(name) ? Number(params.get(name)) : undefined;

  const players = numberParam('players');
  if (isPlayerCount(players)) settings.playerCount = players;
  for (const player of [0, 1] as const) {
    const level = numberParam(`p${player}`);
    if (isLevel(level)) settings.levels[player] = level;
    if (params.has(`shapes${player}`)) settings.shapes[player] = params.get(`shapes${player}`) === '1';
    if (params.has(`faces${player}`)) settings.faces[player] = params.get(`faces${player}`) === '1';
  }
  const length = params.get('length');
  if (isLength(length)) settings.length = length;
  const song = numberParam('song');
  if (isSongIndex(song)) settings.songIndex = song;
  if (params.has('previews')) settings.previews = params.get('previews') === '1';
  if (params.has('hands')) settings.handControl = params.get('hands') === '1';
  if (params.has('record')) settings.record = params.get('record') === '1';

  const tracker = params.get('tracker');
  const input = params.get('input');
  const seed = numberParam('seed');
  return {
    settings,
    input: input === 'mouse' || input === 'bot' ? input : 'camera',
    tracker: isTrackerMode(tracker) ? tracker : undefined,
    startSec: finiteOr(numberParam('start'), 0, 0, 86400),
    autostart: params.get('autostart') === '1',
    seed: seed !== undefined && Number.isInteger(seed) ? seed : DEFAULT_SEED,
    botAccuracy: finiteOr(numberParam('botAccuracy'), 1, 0, 1),
  };
}
