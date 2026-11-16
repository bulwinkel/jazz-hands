// Plays one camera file through the game twice, once with the trackers on the main thread and
// once in the tracking workers, keeps the tracked hands of every frame, and prints how far
// the two runs differ.
//
// Usage:
//   node scripts/compare-threads.mjs --camera-file=<path> [--url=http://localhost:5192/]
//          [--players=2] [--tracker=<mode>] [--faces] [--seconds=45] [--fps=<rate>]
//          [--threads=main,worker]
//
//   --camera-file  The recording. A .y4m or .mjpeg file plays as it is. Any other video goes
//                  through ffmpeg first, into a 30 fps .mjpeg file at most 1920 pixels wide.
//   --url          A running dev server or `vite preview` of the game. Default as above.
//   --players      1 or 2. Default 2.
//   --tracker      hands-full, hands-split or pose. Default: the game's choice for the players.
//   --faces        Turn on face cues for every player, so that the face models run too: in the
//                  countdown, and in play around the face cues. A run whose tracker finds a face
//                  in fewer than 10 frames before play drops its face cues, and then runs no face
//                  model in play.
//   --seconds      How long each run records, from the page load. Default 45. The round starts
//                  at once, without the menu or a calibration; Space is pressed on the ready screen.
//   --fps          The rate Chrome plays the file at. Default: from a .y4m header, else 30.
//   --threads      The threads of the two runs. Default main,worker. main,main shows how much
//                  two runs on one thread differ: the floor for main against worker.
//
// The two runs match frames by the camera stream's own clock, so frames that both runs
// tracked are compared one to one. Saves both frame logs and the comparison to
// test-results/compare-threads-<time>.json.
//
// Compares the runs only when each tracked frames on the thread it asked for, both on the
// same delegate, with no error on the page or in a worker and without the game's error
// phase. Exits 0 then, else 1.

import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, readSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { CAMERA_FILE_TYPES, openHeadlessChrome } from './headless-chrome.mjs';
import { compareRuns, shiftCheck } from './thread-comparison.mjs';

const THREADS = ['main', 'worker'];
const POLL_MS = 250;

const flags = process.argv.slice(2);
const flag = (name) => flags.find((f) => f.startsWith(`--${name}=`))?.slice(name.length + 3);
const sourceFile = flag('camera-file');
if (!sourceFile) {
  console.error('Usage: node scripts/compare-threads.mjs --camera-file=<path> [--url=<game url>] [--players=2] [--tracker=<mode>] [--faces] [--seconds=45] [--fps=<rate>]');
  process.exit(2);
}
const gameUrl = flag('url') ?? 'http://localhost:5192/';
const players = flag('players') ?? '2';
const tracker = flag('tracker');
const faces = flags.includes('--faces');
const seconds = Number(flag('seconds') ?? 45);
const threads = (flag('threads') ?? 'main,worker').split(',');
if (threads.length !== 2 || !threads.every((thread) => THREADS.includes(thread))) {
  console.error('--threads takes two of main and worker, for example main,worker or main,main.');
  process.exit(2);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const sourcePath = resolve(sourceFile);
let cameraFile;
try {
  cameraFile = cameraReadyFile(sourcePath);
  process.exitCode = await compareThreads();
} finally {
  // A converted recording can take hundreds of megabytes.
  if (cameraFile && cameraFile !== sourcePath) rmSync(dirname(cameraFile), { recursive: true, force: true });
}

/** Records both runs, prints and saves the result, and returns the exit code. */
async function compareThreads() {
  const fps = Number(flag('fps') ?? y4mHeader(cameraFile)?.fps ?? 30);
  const aspect = frameAspect(cameraFile);
  console.log(`camera: ${sourcePath} · ${fps} fps · aspect ${aspect.toFixed(3)}`);

  const runs = [];
  for (const [index, thread] of threads.entries()) runs.push(await recordRun(thread, `run ${index + 1}`));
  for (const run of runs) printRun(run);

  const problems = runProblems(runs);
  let comparison;
  let shifts;
  if (problems.length) {
    console.log('\nnot compared:');
    for (const problem of problems) console.log(`  ${problem}`);
  } else {
    const [first, second] = runs;
    comparison = compareRuns(first.frames, second.frames, { fps, aspect });
    shifts = shiftCheck(first.frames, second.frames, { fps, aspect });
    printComparison(runs, comparison, shifts);
  }

  const settings = { cameraFile: sourcePath, fps, aspect, players, tracker, faces, seconds, threads };
  console.log(`saved: ${saveResult({ ...settings, runs, problems, comparison, shifts })}`);
  return problems.length ? 1 : 0;
}

/** Why the two runs cannot be compared. None when they can. */
function runProblems(runs) {
  const problems = [];
  for (const run of runs) {
    if (run.phases.some((seen) => seen.phase === 'error')) problems.push(`${run.label} ended in the game's error phase.`);
    if (run.errors.length) problems.push(`${run.label} had errors on the page or in a worker.`);
    if (!run.frames.length) problems.push(`${run.label} logged no frames.`);
    else if (run.threads.join() !== run.thread) {
      problems.push(`${run.label} asked for the ${run.thread} thread, but ran on ${run.threads.join(' and ')}.`);
    }
    if (run.delegates.length > 1) problems.push(`${run.label} ran on more than one delegate: ${run.delegates.join(' and ')}.`);
  }
  const [first, second] = runs.map((run) => run.delegates.join(' and '));
  if (first && second && first !== second) {
    problems.push(`The runs ran on different delegates (${first}, ${second}): their hands are not comparable.`);
  }
  return problems;
}

// --- The camera file ---

/** A file Chrome can play as a camera: the file itself, or an .mjpeg copy made with ffmpeg. */
function cameraReadyFile(path) {
  if (CAMERA_FILE_TYPES.includes(extname(path).toLowerCase())) return path;
  const converted = join(mkdtempSync(join(tmpdir(), 'dance-camera-')), 'camera.mjpeg');
  console.log(`Converting ${path} for Chrome's fake camera…`);
  const ffmpeg = spawnSync(
    'ffmpeg',
    ['-loglevel', 'error', '-y', '-i', path, '-an', '-vf', "scale='min(1920,iw)':-2,fps=30",
      '-c:v', 'mjpeg', '-q:v', '4', '-f', 'mjpeg', converted],
    { stdio: 'inherit' },
  );
  if (ffmpeg.error || ffmpeg.status !== 0) {
    console.error('ffmpeg could not convert the file. Install ffmpeg, or pass a .y4m or .mjpeg file.');
    process.exit(2);
  }
  return converted;
}

/** Size and frame rate from the header of a .y4m file, which starts with a text line. */
function y4mHeader(path) {
  if (extname(path).toLowerCase() !== '.y4m') return undefined;
  const bytes = Buffer.alloc(256);
  const file = openSync(path, 'r');
  readSync(file, bytes, 0, bytes.length, 0);
  closeSync(file);
  const header = bytes.toString('latin1').split('\n')[0];
  const field = (letter) => header.split(' ').find((part) => part.startsWith(letter))?.slice(1);
  const [numerator, denominator] = (field('F') ?? '30:1').split(':').map(Number);
  return { width: Number(field('W')), height: Number(field('H')), fps: numerator / denominator };
}

/** Width over height of the camera picture. Hand distances are measured in frame heights. */
function frameAspect(path) {
  const header = y4mHeader(path);
  if (header) return header.width / header.height;
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path]);
  const [width, height] = probe.status === 0 ? probe.stdout.toString().trim().split(',').map(Number) : [];
  return width > 0 && height > 0 ? width / height : 16 / 9;
}

// --- One run of the game ---

async function recordRun(thread, label) {
  // Both runs play cue set 1. The game picks a set at random by default, and with --faces the
  // face models run in play only around the face cues of the set's chart.
  const params = new URLSearchParams({ input: 'camera', autostart: '1', framelog: '1', previews: '0', hands: '0', set: '1', players, thread });
  if (tracker) params.set('tracker', tracker);
  if (faces) for (const player of ['0', '1']) params.set(`faces${player}`, '1');
  const url = `${gameUrl}?${params}`;
  console.log(`${label}, ${thread}: ${url}`);

  const chrome = await openHeadlessChrome({ cameraFile });
  try {
    const errors = await chrome.watchErrors();
    await chrome.send('Page.navigate', { url });
    const phases = await playFor(chrome);
    const frames = JSON.parse((await chrome.evaluate('JSON.stringify(window.__dance?.frameLog ?? [])')) ?? '[]');
    const distinct = (key) => [...new Set(frames.map((frame) => frame[key]))];
    return { label, thread, url, phases, errors, frames, threads: distinct('thread'), delegates: distinct('delegate') };
  } finally {
    chrome.close();
  }
}

/** Lets the game play for `--seconds`, presses Space on the ready screen, and returns the phases seen. */
async function playFor(chrome) {
  const phases = [];
  const startedMs = Date.now();
  let pressed = false;
  while (Date.now() - startedMs < seconds * 1000) {
    await sleep(POLL_MS);
    const phase = await chrome.evaluate('window.__dance?.phase');
    if (!phase) continue;
    if (phases.at(-1)?.phase !== phase) phases.push({ phase, atSec: Number(((Date.now() - startedMs) / 1000).toFixed(1)) });
    if (phase === 'ready' && !pressed) {
      pressed = true;
      await chrome.pressSpace();
    }
    if (phase === 'error') break;
  }
  return phases;
}

// --- The report ---

function printRun(run) {
  const { frames } = run;
  const span = frames.length > 1 ? (frames.at(-1).timeMs - frames[0].timeMs) / 1000 : 0;
  const hands = frames.reduce((sum, frame) => sum + frame.players.reduce((n, player) => n + player.hands.length, 0), 0);
  const inference = frames.map((frame) => frame.inferenceMs);
  console.log(`\n${run.label}, ${run.thread} thread asked for`);
  const trackers = [...new Set(frames.map((frame) => frame.mode))].join(', ');
  console.log(`  ran on:   ${run.threads.join(', ') || 'no frames'} · ${run.delegates.join(', ') || '—'} · trackers ${trackers}`);
  console.log(`  phases:   ${run.phases.map((seen) => `${seen.atSec}s ${seen.phase}`).join(' | ')}`);
  console.log(`  frames:   ${frames.length} · ${span ? (frames.length / span).toFixed(1) : '—'} per second`);
  console.log(`  hands:    ${frames.length ? (hands / frames.length).toFixed(2) : '—'} per frame`);
  console.log(`  inference ${inference.length ? (inference.reduce((a, b) => a + b, 0) / inference.length).toFixed(1) : '—'} ms mean`);
  console.log(`  errors:   ${run.errors.length ? run.errors.join(' | ') : 'none'}`);
}

function printComparison(runs, result, shifts) {
  const percent = (share) => (share === null ? '—' : `${(share * 100).toFixed(1)}%`);
  const heights = ({ median, p95, max }) => `median ${median ?? '—'} · p95 ${p95 ?? '—'} · max ${max ?? '—'}`;
  const [first, second] = runs;
  console.log(`\n${first.thread} against ${second.thread}, both on ${first.delegates.join()}, on camera frames both tracked`);
  console.log(`  frames:          ${result.matchedFrames} matched (${first.label} ${result.framesA}, ${second.label} ${result.framesB}, ${result.otherMode} with other trackers)`);
  console.log(`  same hand count: ${percent(result.sameHandCount)} of player slots`);
  console.log(`  paired hands:    ${result.pairedHands}`);
  console.log(`  palm distance:   ${heights(result.palmDistance)} (frame heights)`);
  console.log(`  size difference: ${heights(result.sizeDifference)} (frame heights)`);
  console.log(`  same shape:      ${percent(result.sameGesture)} of paired hands`);
  if (result.facesCompared) {
    console.log(`  faces compared:  ${result.facesCompared}`);
    console.log(`  face distance:   ${heights(result.faceDistance)} (frame heights)`);
    console.log(`  expression diff: ${heights(result.expressionDifference)} (0..1)`);
  }
  const line = shifts.map(({ shift, medianPalmDistance }) => `${shift >= 0 ? '+' : ''}${shift}: ${medianPalmDistance ?? '—'}`).join(' · ');
  console.log(`  frame match check, median palm distance by frame shift: ${line}`);
  console.log('  (With hands that move, the least distance belongs at shift 0.)');
}

function saveResult(result) {
  const folder = resolve('test-results');
  mkdirSync(folder, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
  const path = join(folder, `compare-threads-${stamp}.json`);
  writeFileSync(path, `${JSON.stringify(result)}\n`);
  return path;
}
