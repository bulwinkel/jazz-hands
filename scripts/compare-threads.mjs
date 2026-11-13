// Plays one camera file through the game twice, once with the trackers on the main thread and
// once in the tracking workers, keeps the tracked hands of every frame, and prints how far
// the two runs differ.
//
// Usage:
//   node scripts/compare-threads.mjs --camera-file=<path> [--url=http://localhost:5192/]
//          [--players=2] [--tracker=<mode>] [--faces] [--seconds=45] [--fps=<rate>]
//
//   --camera-file  The recording. A .y4m or .mjpeg file plays as it is. Any other video goes
//                  through ffmpeg first, into a 30 fps .mjpeg file at most 1920 pixels wide.
//   --url          A running dev server or `vite preview` of the game. Default as above.
//   --players      1 or 2. Default 2.
//   --tracker      hands-full, hands-split or pose. Default: the game's choice for the players.
//   --faces        Turn on face cues for every player, so that the face models run too.
//   --seconds      How long each run records, from the page load. Default 45. The round starts
//                  at once, without the menu; Space is pressed at the ready check.
//   --fps          The rate Chrome plays the file at. Default: from a .y4m header, else 30.
//
// The two runs match frames by the camera stream's own clock, so frames that both runs
// tracked are compared one to one. Saves both frame logs and the comparison to
// test-results/compare-threads-<time>.json.
// Exits 0 when both runs tracked frames on the thread they asked for with no page error, else 1.

import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, readSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
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

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const cameraFile = cameraReadyFile(resolve(sourceFile));
const fps = Number(flag('fps') ?? y4mHeader(cameraFile)?.fps ?? 30);
const aspect = frameAspect(cameraFile);
console.log(`camera: ${cameraFile} · ${fps} fps · aspect ${aspect.toFixed(3)}`);

const runs = [];
for (const thread of THREADS) runs.push(await recordRun(thread));
for (const run of runs) printRun(run);

const [main, worker] = runs;
const comparison = compareRuns(main.frames, worker.frames, { fps, aspect });
const shifts = shiftCheck(main.frames, worker.frames, { fps, aspect });
printComparison(comparison, shifts);

const savedTo = saveResult({ cameraFile, fps, aspect, players, tracker, faces, seconds, runs, comparison, shifts });
console.log(`saved: ${savedTo}`);

const ranAsAsked = runs.every((run) => run.frames.length > 0 && run.threads.length === 1 && run.threads[0] === run.thread);
process.exit(ranAsAsked && runs.every((run) => run.errors.length === 0) ? 0 : 1);

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

async function recordRun(thread) {
  const params = new URLSearchParams({ input: 'camera', autostart: '1', framelog: '1', previews: '0', hands: '0', players, thread });
  if (tracker) params.set('tracker', tracker);
  if (faces) for (const player of ['0', '1']) params.set(`faces${player}`, '1');
  const url = `${gameUrl}?${params}`;
  console.log(`run ${thread}: ${url}`);

  const chrome = await openHeadlessChrome({ cameraFile });
  const errors = [];
  chrome.onEvent((message) => {
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      errors.push(details.exception?.description ?? details.text);
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      const text = message.params.args.map((arg) => arg.value ?? arg.description).join(' ');
      // MediaPipe writes its INFO lines through console.error. They are not errors.
      if (!text.startsWith('INFO:')) errors.push(`console.error: ${text}`);
    }
  });
  await chrome.send('Runtime.enable');
  await chrome.send('Page.navigate', { url });

  const phases = [];
  const startedMs = Date.now();
  while (Date.now() - startedMs < seconds * 1000) {
    await sleep(POLL_MS);
    const phase = await chrome.evaluate('window.__dance?.phase');
    if (!phase) continue;
    if (phases.at(-1)?.phase !== phase) phases.push({ phase, atSec: Number(((Date.now() - startedMs) / 1000).toFixed(1)) });
    if (phase === 'ready' && !phases.some((seen) => seen.pressed)) {
      phases.at(-1).pressed = true;
      await pressSpace(chrome);
    }
    if (phase === 'error') break;
  }
  const frames = JSON.parse((await chrome.evaluate('JSON.stringify(window.__dance?.frameLog ?? [])')) ?? '[]');
  chrome.close();
  return { thread, url, phases, errors, frames, threads: [...new Set(frames.map((frame) => frame.thread))] };
}

async function pressSpace(chrome) {
  const key = { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 };
  await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
  await chrome.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
}

// --- The report ---

function printRun(run) {
  const { frames } = run;
  const span = frames.length > 1 ? (frames.at(-1).timeMs - frames[0].timeMs) / 1000 : 0;
  const hands = frames.reduce((sum, frame) => sum + frame.players.reduce((n, player) => n + player.hands.length, 0), 0);
  const inference = frames.map((frame) => frame.inferenceMs);
  console.log(`\n${run.thread} run`);
  console.log(`  ran on:   ${run.threads.join(', ') || 'no frames'} · trackers ${[...new Set(frames.map((frame) => frame.mode))].join(', ')}`);
  console.log(`  phases:   ${run.phases.map((seen) => `${seen.atSec}s ${seen.phase}`).join(' | ')}`);
  console.log(`  frames:   ${frames.length} · ${span ? (frames.length / span).toFixed(1) : '—'} per second`);
  console.log(`  hands:    ${frames.length ? (hands / frames.length).toFixed(2) : '—'} per frame`);
  console.log(`  inference ${inference.length ? (inference.reduce((a, b) => a + b, 0) / inference.length).toFixed(1) : '—'} ms mean`);
  console.log(`  errors:   ${run.errors.length ? run.errors.join(' | ') : 'none'}`);
}

function printComparison(result, shifts) {
  const percent = (share) => (share === null ? '—' : `${(share * 100).toFixed(1)}%`);
  const heights = ({ median, p95, max }) => `median ${median ?? '—'} · p95 ${p95 ?? '—'} · max ${max ?? '—'}`;
  console.log('\nmain against worker, on camera frames both tracked');
  console.log(`  frames:          ${result.matchedFrames} matched (main ${result.framesA}, worker ${result.framesB}, ${result.otherMode} with other trackers)`);
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
