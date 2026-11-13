// Runs the game in headless Chrome and reports what happened. For automated checks.
//
// Usage:
//   node scripts/smoke.mjs <url> [--seconds=90] [--press=<phase>] [--until=<phase>]
//                                [--shot=<phase>:<file>[:<delayMs>]] [--size=<width>x<height>]
//                                [--camera-file=<path>]
//
//   --seconds  Give up after this long. Default 90.
//   --press    Press Space once when the game reaches this phase (for example `ready`).
//   --until    Stop when the game reaches this phase. Default `results`.
//   --shot     Save a screenshot when the game reaches a phase, after an optional delay.
//   --size     Browser window size as <width>x<height>. Default 1440x900.
//   --hover    Move the mouse pointer onto the element with this CSS selector, in the menu,
//              and leave it there. With `input=mouse` the pointer is an open hand.
//   --fist     With --hover: also hold the 1 key, which makes the pointer hand a fist.
//   --camera-file  Play this .y4m or .mjpeg file as the camera, in a loop. Without it, the
//              camera is Chrome's built-in test picture, which shows no hands.
//
// The camera is always a fake camera, never the real one. Sound is muted.
// The game needs a dev server, for example: npx vite --port 5174 --strictPort
//
// Example: a simulated player on level 3, one player, starting 45 s into the song:
//   node scripts/smoke.mjs "http://localhost:5174/?input=bot&autostart=1&players=1&p0=3&start=45"
//
// Prints the phases the game went through, the final `window.__dance` state and any page errors.
// Exits 0 when the game reached the `--until` phase with no page error, else 1.

import { writeFileSync } from 'node:fs';
import { openHeadlessChrome } from './headless-chrome.mjs';

const POLL_MS = 250;

const [url, ...flags] = process.argv.slice(2);
if (!url) {
  console.error('Usage: node scripts/smoke.mjs <url> [--seconds=90] [--press=<phase>] [--until=<phase>] [--shot=<phase>:<file>[:<delayMs>]]');
  process.exit(2);
}
const flag = (name) => flags.find((f) => f.startsWith(`--${name}=`))?.slice(name.length + 3);
const maxSeconds = Number(flag('seconds') ?? 90);
const pressAtPhase = flag('press');
const untilPhase = flag('until') ?? 'results';
const [shotPhase, shotFile, shotDelayMs] = flag('shot')?.split(':') ?? [];
const windowSize = flag('size') ?? '1440x900';
const hoverSelector = flag('hover');
const makeFist = flags.includes('--fist');
const cameraFile = flag('camera-file');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Start Chrome and watch its page for errors ---

const chrome = await openHeadlessChrome({ windowSize, cameraFile }).catch((error) => {
  console.error(error.message);
  process.exit(2);
});
const { send, evaluate } = chrome;
const pageErrors = [];

chrome.onEvent((message) => {
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails;
    pageErrors.push(details.exception?.description ?? details.text);
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    const text = message.params.args.map((arg) => arg.value ?? arg.description).join(' ');
    // MediaPipe writes its INFO lines through console.error. They are not errors.
    if (!text.startsWith('INFO:')) pageErrors.push(`console.error: ${text}`);
  }
});

async function pressSpace() {
  const key = { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
}

async function movePointerOnto(selector) {
  const centre = await evaluate(`(() => {
    const box = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
    return box ? JSON.stringify({ x: box.left + box.width / 2, y: box.top + box.height / 2 }) : null;
  })()`);
  if (!centre) throw new Error(`No element matches ${selector}`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...JSON.parse(centre) });
}

async function saveScreenshot(file) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(data, 'base64'));
}

// --- Load the game and watch it ---

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url });

const phasesSeen = [];
let pressed = false;
let hovered = false;
let shotTaken = false;
let reached = false;
const startedMs = Date.now();
const elapsedSec = () => (Date.now() - startedMs) / 1000;

while (elapsedSec() < maxSeconds) {
  await sleep(POLL_MS);
  const phase = await evaluate('window.__dance?.phase');
  if (!phase) continue;
  if (phasesSeen.at(-1)?.phase !== phase) phasesSeen.push({ phase, atSec: elapsedSec().toFixed(1) });

  if (hoverSelector && phase === 'menu' && !hovered) {
    hovered = true;
    await movePointerOnto(hoverSelector);
    if (makeFist) await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '1', code: 'Digit1', windowsVirtualKeyCode: 49 });
  }
  if (phase === pressAtPhase && !pressed) {
    pressed = true;
    await pressSpace();
  }
  if (phase === shotPhase && !shotTaken) {
    shotTaken = true;
    await sleep(Number(shotDelayMs ?? 0));
    await saveScreenshot(shotFile);
  }
  if (phase === untilPhase || phase === 'error') {
    reached = phase === untilPhase;
    await sleep(500); // Let the last frame settle before reading the final state.
    break;
  }
}

console.log('phases:', phasesSeen.map((seen) => `${seen.atSec}s ${seen.phase}`).join(' | '));
// The run report is large: print the state without it. It is saved to test-results/ anyway.
console.log('final:', await evaluate('JSON.stringify({ ...window.__dance, report: undefined })'));
console.log('errors:', pageErrors.length ? pageErrors : 'none');

chrome.close();
process.exit(reached && pageErrors.length === 0 ? 0 : 1);
