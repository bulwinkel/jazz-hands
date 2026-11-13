// Summarizes the ratings that players gave the cue sets on the results screen.
//
// Usage:
//   npm run ratings [-- <path>]
//   node scripts/ratings-summary.mjs [<path>]
//
//   <path>  The ratings file. Default test-results/cue-set-ratings.jsonl, which the dev server
//           writes: one record for each star a player chooses (see src/game/cueSetRating.ts).
//
// A player may change a rating, so the file can hold more than one record of the same round
// and player. Only the last one counts. Prints the mean rating and the number of ratings by
// level and set, by level and share of moves, and by song.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_PATH = 'test-results/cue-set-ratings.jsonl';

/** The fields that the summary reads, and what each must hold. */
const FIELD_CHECKS = {
  savedAt: (value) => typeof value === 'string',
  roundId: (value) => typeof value === 'string',
  player: (value) => value === 0 || value === 1,
  song: (value) => typeof value === 'string',
  level: (value) => Number.isInteger(value),
  cueSet: (value) => Number.isInteger(value),
  moveShare: (value) => typeof value === 'number',
  rating: (value) => Number.isInteger(value) && value >= 1 && value <= 5,
};

/** The tables that the summary prints: a title, the columns of the group, and a record's group. */
export const SUMMARIES = [
  { title: 'By level and set', columns: ['Level', 'Set'], groupOf: (record) => [record.level, record.cueSet] },
  {
    title: 'By level and share of moves',
    columns: ['Level', 'Moves'],
    groupOf: (record) => [record.level, record.moveShare],
  },
  { title: 'By song', columns: ['Song'], groupOf: (record) => [record.song] },
];

/**
 * Reads the lines of a ratings file. A line that is not a whole record, such as a line cut
 * short or one of another kind, is left out and counted in `skipped`. Empty lines do not count.
 */
export function readRatings(text) {
  const records = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const record = parseRecord(line);
    if (record) records.push(record);
    else skipped++;
  }
  return { records, skipped };
}

/** The record on one line, or null when the line holds none. */
function parseRecord(line) {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  return isRecord(value) ? value : null;
}

function isRecord(value) {
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(FIELD_CHECKS).every(([field, check]) => check(value[field]));
}

/**
 * Keeps the last record of each round and player: a changed rating replaces the one before.
 * The record saved last wins. Of two saved at the same time, the later line wins.
 */
export function latestRatings(records) {
  const latest = new Map();
  for (const record of records) {
    const key = `${record.roundId} ${record.player}`;
    const kept = latest.get(key);
    if (!kept || record.savedAt >= kept.savedAt) latest.set(key, record);
  }
  return [...latest.values()];
}

/**
 * The number of ratings and their mean in each group. `groupOf` gives the group of a record
 * as a list of values, for example [level, set]. The groups come in the order of their values.
 */
export function groupRatings(records, groupOf) {
  const groups = new Map();
  for (const record of records) {
    const values = groupOf(record);
    const key = JSON.stringify(values);
    const group = groups.get(key) ?? { values, count: 0, sum: 0 };
    group.count++;
    group.sum += record.rating;
    groups.set(key, group);
  }
  const rows = [...groups.values()].map(({ values, count, sum }) => ({ values, count, mean: sum / count }));
  return rows.sort((a, b) => compareValues(a.values, b.values));
}

/** Orders two groups by their first value, then by the next: numbers by size, text by letter. */
function compareValues(a, b) {
  for (let i = 0; i < a.length; i++) {
    const order = compareValue(a[i], b[i]);
    if (order !== 0) return order;
  }
  return 0;
}

function compareValue(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

/** Lays out rows of text as a plain table: a header, a rule, and columns padded to line up. */
export function formatTable(header, rows) {
  const widths = header.map((title, i) => Math.max(title.length, ...rows.map((row) => row[i].length)));
  const line = (cells) => cells.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd();
  const rule = widths.map((width) => '-'.repeat(width));
  return [line(header), line(rule), ...rows.map(line)].join('\n');
}

/** One summary table, with its title. */
function summaryTable(ratings, summary) {
  const rows = groupRatings(ratings, summary.groupOf).map((group) => [
    ...group.values.map(String),
    String(group.count),
    group.mean.toFixed(2),
  ]);
  return `${summary.title}\n${formatTable([...summary.columns, 'Ratings', 'Mean'], rows)}`;
}

/** The whole summary of the records of a file: what counts, then each table. */
export function summaryText(records, skipped) {
  const ratings = latestRatings(records);
  const replaced = records.length - ratings.length;
  const counts = [
    `Ratings: ${ratings.length}`,
    `Records: ${records.length} (${replaced} replaced by a later choice)`,
    `Lines skipped: ${skipped}`,
  ].join('\n');
  if (ratings.length === 0) return counts;
  const tables = SUMMARIES.map((summary) => summaryTable(ratings, summary));
  return [counts, ...tables].join('\n\n');
}

function main() {
  const path = resolve(process.argv[2] ?? DEFAULT_PATH);
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    console.error(`No ratings file at ${path}`);
    process.exit(1);
  }
  const { records, skipped } = readRatings(text);
  console.log(`Ratings in ${path}\n`);
  console.log(summaryText(records, skipped));
}

// The tests import this file for its functions: run only when node runs the file itself.
const isScript = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isScript) main();
