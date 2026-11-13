import type { TrackerMode, TrackingThread } from '../tracking/types';
import { DEFAULT_TRACKING_THREAD, SONGS, TIMING } from './config';
import { isCueSet, isCueSetChoice, RANDOM_CUE_SET } from './cueSet';
import type { CueSetChoice } from './cueSet';
import { clamp } from './numbers';
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
  /**
   * Which of the song's cue sets the round plays, from 1, or 'random': each round from the
   * menu then plays a set picked at random. Both players play the same set.
   */
  cueSet: CueSetChoice;
}

export type InputSource = 'camera' | 'mouse' | 'bot';

/** What a page load starts from: the kept settings plus one-off URL parameters. */
export interface Options {
  settings: Settings;
  input: InputSource;
  /** Tracker named in the URL. Unset means the default for the player count. */
  tracker?: TrackerMode;
  /**
   * Where the camera's trackers run: `main`, the default for now, or `worker`, the tracking
   * workers, which keep the drawing smooth while tracking is busy.
   */
  thread: TrackingThread;
  /** Start the song this far in and drop earlier cues. */
  startSec: number;
  /** Skip the menu. */
  autostart: boolean;
  /** A chart seed from the URL, for tests. It wins over the cue set. */
  seed?: number;
  /**
   * A share of moves from the URL, 0 to 1, for tests. It wins over the share of the cue set.
   * Without it, a seed from the URL plays without moves.
   */
  moves?: number;
  /** Share of cues the test bot plays. */
  botAccuracy: number;
  /** Keep every tracking frame in `window.__dance.frameLog`, for scripts that compare runs. */
  frameLog: boolean;
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
    cueSet: RANDOM_CUE_SET,
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
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

/** The choice that a `set=` value names: `random` or a set number. Undefined for any other value. */
function cueSetParam(value: string | null): CueSetChoice | undefined {
  if (value === RANDOM_CUE_SET) return RANDOM_CUE_SET;
  const set = Number(value);
  return isCueSet(set) ? set : undefined;
}

/**
 * Reads kept settings field by field. A missing or invalid field keeps its default, and a
 * field the game no longer has is ignored, so settings saved by an older version of the game
 * never break a newer one.
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
  if (isCueSetChoice(saved.cueSet)) settings.cueSet = saved.cueSet;
  settings.inputLatencyMs = finiteOr(saved.inputLatencyMs, settings.inputLatencyMs, ...TIMING.inputLatencyRangeMs);
  settings.avOffsetMs = finiteOr(saved.avOffsetMs, settings.avOffsetMs, ...TIMING.avOffsetRangeMs);
  return settings;
}

/**
 * URL parameters, all optional:
 *   players=1|2   p0, p1=1..5   shapes0, shapes1=1|0   faces0, faces1=1|0
 *   length=short|full   song=<index from 0>   previews=1|0   hands=1|0   record=1|0
 *   set=random|1..6
 *   tracker=hands-full|hands-split|pose   input=camera|mouse|bot   thread=worker|main
 *   start=<seconds>   autostart=1   seed=<integer>   moves=<0..1>   botAccuracy=<0..1>   framelog=1
 *
 * `set=random` picks a set at random for each round from the menu (see cueSet.ts). `seed=`
 * replaces the cue set's seed and plays without moves. `moves=` gives the share of phrases in
 * busy music that hold a move, with a cue set or with `seed=`.
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
  const cueSet = cueSetParam(params.get('set'));
  if (cueSet !== undefined) settings.cueSet = cueSet;

  const tracker = params.get('tracker');
  const thread = params.get('thread');
  const input = params.get('input');
  const seed = numberParam('seed');
  const moves = numberParam('moves');
  return {
    settings,
    input: input === 'mouse' || input === 'bot' ? input : 'camera',
    tracker: isTrackerMode(tracker) ? tracker : undefined,
    thread: thread === 'main' || thread === 'worker' ? thread : DEFAULT_TRACKING_THREAD,
    startSec: finiteOr(numberParam('start'), 0, 0, 86400),
    autostart: params.get('autostart') === '1',
    seed: seed !== undefined && Number.isInteger(seed) ? seed : undefined,
    moves: moves !== undefined && Number.isFinite(moves) ? clamp(moves, 0, 1) : undefined,
    botAccuracy: finiteOr(numberParam('botAccuracy'), 1, 0, 1),
    frameLog: params.get('framelog') === '1',
  };
}
