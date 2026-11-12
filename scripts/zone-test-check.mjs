// Checks the zone test page in headless Chrome and reports what it measured. For automated checks.
//
// Usage:
//   node scripts/zone-test-check.mjs [--port=5176] [--zones=3,4] [--camera=<file>] [--full]
//                                    [--keep] [--shots=<folder>]
//
//   --port    Port of the dev server. Default 5176.
//   --zones   Zone counts to check, separated by commas. Default 3,4.
//   --camera  A .y4m or .mjpeg file that Chrome plays as the camera picture, in place of its
//             test pattern. Use it to show the trackers a picture with hands.
//   --full    Run the test at its real length, 2.5 minutes for each zone count. The default is
//             the quick run, which is too short for its numbers to mean anything.
//   --keep    Keep the report files in test-results/. By default this script deletes them.
//   --shots   Folder for screenshots of the live view, a recording and the results screen.
//
// The camera is always Chrome's fake camera, never the real one.
// The page is always opened with silent=1. Chrome's --mute-audio does not stop the page's
// spoken cues: they come from the system voice and would talk into the room.
// The page needs a dev server, for example: npx vite --port 5176 --strictPort
//
// For each zone count the script:
//   1. shows each of the four variants live and waits until it tracks camera frames,
//   2. runs the test to the results screen,
//   3. reads the report file the dev server wrote and checks that it is complete.
// The first zone count comes from the URL. A later one, 3 or 4, is chosen with its key on the
// same page, as a person would do it, so the page also has to close every model and load new ones.
// During the last run the dev server cannot be reached. The page must keep that report and
// send it when it loads the next time.
// Exits 0 when all of that worked with no page error, else 1.

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const POLL_MS = 250;
/** A variant counts as tracking once it has read this many camera frames. */
const FRAMES_TO_TRACK = 30;
/** Let the live numbers settle for this long before they are read. They are means over 2 s. */
const SETTLE_MS = 2500;
const VARIANTS = [
  { layout: 'full', model: 'gesture' },
  { layout: 'full', model: 'landmarks' },
  { layout: 'crops', model: 'gesture' },
  { layout: 'crops', model: 'landmarks' },
];
const PHASES_PER_VARIANT = 5;
/** Where the page posts its report. */
const SAVE_URL_PATTERN = '*/__tracking-results*';
/** What the page's status line says about a report it could not save, and about one it sent later. */
const NOT_SAVED_TEXT = 'not on disk';
const SENT_LATER_TEXT = 'An earlier report is now saved: ';

const flags = process.argv.slice(2);
const flag = (name) => flags.find((f) => f.startsWith(`--${name}=`))?.slice(name.length + 3);
const hasFlag = (name) => flags.includes(`--${name}`);
const port = Number(flag('port') ?? 5176);
const zoneCounts = (flag('zones') ?? '3,4').split(',').map(Number);
const cameraFile = flag('camera');
const fullLength = hasFlag('full');
const keepReports = hasFlag('keep');
const shotFolder = flag('shots');

if (zoneCounts.slice(1).some((zones) => zones !== 3 && zones !== 4)) {
  console.error('Only the first zone count can be 1 or 2. The page has keys for 3 and 4 only.');
  process.exit(2);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// --- Start Chrome and connect to its DevTools port ---

const debugPort = 9300 + Math.floor(Math.random() * 600);
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'zone-test-check-'))}`,
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    ...(cameraFile ? [`--use-file-for-fake-video-capture=${resolve(cameraFile)}`] : []),
    '--window-size=1512,982',
    '--no-first-run',
    '--mute-audio',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
// Chrome must not outlive this script, also when the script is stopped half way.
process.on('exit', () => chrome.kill());
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

async function findPage() {
  for (let attempt = 0; attempt < 40; attempt++) {
    await sleep(250);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
      const page = targets.find((target) => target.type === 'page');
      if (page) return page;
    } catch {
      // Chrome is still starting.
    }
  }
  throw new Error('Chrome did not start.');
}

const socket = new WebSocket((await findPage()).webSocketDebuggerUrl);
await new Promise((opened) => socket.addEventListener('open', opened));

let nextId = 0;
const pending = new Map();
const pageErrors = [];
/** How often the page loaded, and how often this script made it load. More means it reloaded by itself. */
let pageLoads = 0;
let expectedPageLoads = 0;

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message.result);
    pending.delete(message.id);
  }
  if (message.method === 'Page.frameNavigated' && !message.params.frame.parentId) pageLoads++;
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails;
    pageErrors.push(details.exception?.description ?? details.text);
  }
  if (message.method === 'Runtime.consoleAPICalled') {
    const { type } = message.params;
    const text = message.params.args.map((arg) => arg.value ?? arg.description).join(' ');
    // MediaPipe writes its INFO lines through console.error. They are not errors.
    if (type === 'error' && !text.startsWith('INFO:')) pageErrors.push(`console.error: ${text}`);
    // Chrome warns when a page has too many WebGL contexts and drops one. A model dies with it.
    if (type === 'warning' && text.includes('WebGL')) pageErrors.push(`console.warn: ${text}`);
  }
});

function send(method, params = {}) {
  return new Promise((answered) => {
    const id = ++nextId;
    pending.set(id, answered);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const reply = await send('Runtime.evaluate', { expression, returnByValue: true });
  return reply.result?.value;
}

/**
 * The page's live state, or null while the page still loads.
 * The report is left out: it is large and is read from its file.
 */
async function pageState() {
  const json = await evaluate('JSON.stringify({ ...window.__zoneTest, report: undefined })');
  const state = json ? JSON.parse(json) : null;
  return state?.mode ? state : null;
}

/** Presses a letter or digit key. */
async function pressKey(key) {
  const code = /\d/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`;
  const event = { key, code, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...event });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
}

/** Waits until the page state passes `isReached`, and returns that state. */
async function waitFor(what, isReached, maxSeconds) {
  const startedMs = Date.now();
  let state = null;
  while (Date.now() - startedMs < maxSeconds * 1000) {
    await sleep(POLL_MS);
    state = await pageState();
    if (state?.mode === 'failed') throw new Error(`The page failed while waiting for ${what}.`);
    if (state && isReached(state)) return state;
  }
  throw new Error(`Timed out after ${maxSeconds} s waiting for ${what}. Last state: ${JSON.stringify(state)}`);
}

async function saveScreenshot(name) {
  if (!shotFolder) return;
  mkdirSync(shotFolder, { recursive: true });
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(shotFolder, name), Buffer.from(data, 'base64'));
}

// --- The checks ---

/** Presses the keys that take the page to a variant: L changes the layout, M the model. */
async function showVariant(variant) {
  const state = await pageState();
  if (state.layout !== variant.layout) await pressKey('l');
  if (state.model !== variant.model) await pressKey('m');
}

/** Shows each variant live, waits until it tracks, and returns its live numbers. */
async function tourVariants(zones) {
  const seen = [];
  for (const variant of VARIANTS) {
    await showVariant(variant);
    const name = `${variant.layout} · ${variant.model}`;
    const isTracking = (state) =>
      state.layout === variant.layout &&
      state.model === variant.model &&
      state.delegate !== 'loading' &&
      state.frames >= FRAMES_TO_TRACK;
    await waitFor(`${name} to track with ${zones} zones`, isTracking, 60);
    await sleep(SETTLE_MS);
    const state = await waitFor(`${name} to go on tracking`, isTracking, 10);
    seen.push({
      variant: name,
      delegate: state.delegate,
      fps: state.framesPerSec.toFixed(1),
      'inference ms': state.inferenceMs?.toFixed(1),
      'hands per zone': state.handsPerZone.join(' | '),
    });
    await saveScreenshot(`live-${zones}-zones-${variant.layout}-${variant.model}.png`);
  }
  return seen;
}

/** The longest a test run may take, with time to load the trackers. */
const RUN_MAX_SECONDS = fullLength ? 240 : 90;

/** Runs the test to the results screen and returns the path of the report file. */
async function runTest(zones) {
  await pressKey('b');
  if (shotFolder) {
    await waitFor('the first recording', (state) => state.mode === 'running', 60);
    await sleep(fullLength ? 13_000 : 2500);
    await saveScreenshot(`run-${zones}-zones.png`);
  }
  const state = await waitFor(
    'the results screen and the saved report',
    (each) => each.mode === 'results' && each.savedPath,
    RUN_MAX_SECONDS,
  );
  await saveScreenshot(`results-${zones}-zones.png`);
  return state.savedPath;
}

/**
 * Runs the test while the dev server cannot be reached, then loads the page again.
 * The page must keep the report and send it on that load. Returns the path of the report file.
 */
async function runTestWithLostSave() {
  await send('Network.setBlockedURLs', { urls: [SAVE_URL_PATTERN] });
  await pressKey('b');
  await waitFor(
    'the page to say that the report is not saved',
    (state) => state.mode === 'results' && state.status.includes(NOT_SAVED_TEXT),
    RUN_MAX_SECONDS,
  );
  console.log('the save was blocked, and the page kept the report.');

  await send('Network.setBlockedURLs', { urls: [] });
  expectedPageLoads++;
  await send('Page.reload');
  const state = await waitFor(
    'the page to send the kept report after a reload',
    (each) => each.status.startsWith(SENT_LATER_TEXT),
    30,
  );
  console.log('after a reload the page sent the kept report.');
  return state.status.slice(SENT_LATER_TEXT.length);
}

/** What is wrong with a report file. An empty list means the report is complete. */
function reportProblems(report, zones) {
  const problems = [];
  if (report.kind !== 'zone-test') problems.push(`kind is ${report.kind}`);
  if (report.zones !== zones) problems.push(`zones is ${report.zones}, not ${zones}`);
  if (report.variants?.length !== VARIANTS.length) problems.push(`${report.variants?.length} variants`);

  for (const variant of report.variants ?? []) {
    const name = `${variant.layout} · ${variant.model}`;
    if (variant.phases?.length !== PHASES_PER_VARIANT) problems.push(`${name}: ${variant.phases?.length} phases`);
    for (const phase of variant.phases ?? []) {
      if (!(phase.frames > 0)) problems.push(`${name}, phase ${phase.phase}: no frames`);
      if (phase.zones?.length !== zones) problems.push(`${name}, phase ${phase.phase}: ${phase.zones?.length} zones`);
    }
    if (!variant.derived?.estimate || !Array.isArray(variant.derived?.notes)) {
      problems.push(`${name}: no derived block`);
    }
  }
  return problems;
}

/** One row for each variant: what the run measured, phase by phase. */
function reportTable(report) {
  return report.variants.map((variant) => {
    const row = { variant: `${variant.layout} · ${variant.model}`, delegate: variant.delegate };
    for (const phase of variant.phases) {
      row[`${phase.phase} ms`] = phase.inferenceMs.mean;
      row[`${phase.phase} hands`] = phase.meanHands;
    }
    row['fps, phase 1'] = variant.phases[0].framesPerSec;
    row['zones with a person'] = variant.derived.occupiedZones.map((zone) => zone + 1).join(',') || 'none';
    row['per hand ms'] = variant.derived.costPerHandMs;
    row['all tracked ms'] = variant.derived.estimate.everyHandTrackedMs;
    return row;
  });
}

function pageUrl(zones) {
  const quick = fullLength ? '' : '&quick=1';
  return `http://localhost:${port}/zone-test.html?zones=${zones}&silent=1${quick}`;
}

/**
 * Loads the page once and throws that load away.
 * The Vite dev server reloads the first page that connects after a source file changed.
 * This load takes that reload, so it cannot hit a check.
 */
async function absorbDevServerReload() {
  await send('Page.navigate', { url: pageUrl(zoneCounts[0]) });
  await sleep(1500);
  pageLoads = 0;
}

/** Opens the page with a zone count from the URL. */
async function openPage(zones) {
  expectedPageLoads++;
  await send('Page.navigate', { url: pageUrl(zones) });
  await waitFor('the camera', (state) => state.mode === 'live', 30);
}

/** Leaves the results screen and chooses another zone count with its key. */
async function switchZones(zones) {
  await evaluate("document.querySelector('#back').click()");
  await waitFor('the camera view', (state) => state.mode === 'live', 10);
  await pressKey(String(zones));
  await waitFor(`${zones} zones`, (state) => state.zones === zones, 10);
}

async function checkZones(zones, loseSave) {
  console.log(`\n=== ${zones} zones: each variant live ===`);
  console.table(await tourVariants(zones));

  console.log(`=== ${zones} zones: ${fullLength ? 'full' : 'quick'} test run ===`);
  const path = loseSave ? await runTestWithLostSave() : await runTest(zones);
  const report = JSON.parse(readFileSync(path, 'utf8'));
  const problems = reportProblems(report, zones);
  console.log(`report file: ${path}`);
  console.log(`camera: ${report.camera.width}×${report.camera.height} at ${report.camera.frameRate} fps`);
  console.log('mean inference ms and mean hands seen, by phase (1 = hands hidden):');
  console.table(reportTable(report));
  console.log('report complete:', problems.length === 0 ? 'yes' : problems);

  if (!keepReports) {
    rmSync(path);
    console.log('report file deleted.');
  }
  return problems.length === 0;
}

await send('Runtime.enable');
await send('Page.enable');
await send('Network.enable');
// Before any script of the page runs, speech and sound are replaced by counters. So a check
// cannot make a sound whatever the page does, and a page that tries to fails the check.
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__soundAttempts = 0;
    Object.defineProperty(speechSynthesis, 'speak', { value: () => { window.__soundAttempts++; } });
    window.AudioContext = class {
      constructor() {
        window.__soundAttempts++;
        throw new Error('An automated check makes no sound.');
      }
    };`,
});

let allPassed = true;
try {
  await absorbDevServerReload();
  for (const [index, zones] of zoneCounts.entries()) {
    if (index === 0) await openPage(zones);
    else await switchZones(zones);
    const isLastRun = index === zoneCounts.length - 1;
    const passed = await checkZones(zones, isLastRun);
    allPassed &&= passed;
  }
} catch (error) {
  allPassed = false;
  console.error(error instanceof Error ? error.stack : String(error));
}

const soundAttempts = await evaluate('window.__soundAttempts');
if (soundAttempts !== 0) pageErrors.push(`The page tried to make sound ${soundAttempts} times in a silent run.`);
if (pageLoads !== expectedPageLoads) {
  pageErrors.push(`The page loaded ${pageLoads} times, not ${expectedPageLoads}. It reloaded by itself.`);
}

console.log('\nsound attempts:', soundAttempts);
console.log('page errors:', pageErrors.length ? pageErrors : 'none');
socket.close();
chrome.kill();
process.exit(allPassed && pageErrors.length === 0 ? 0 : 1);
