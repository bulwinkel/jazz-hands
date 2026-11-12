// Runs the game in headless Chrome and reports what happened. For automated checks.
//
// Usage:
//   node scripts/smoke.mjs <url> [--seconds=90] [--press=<phase>] [--until=<phase>]
//                                [--shot=<phase>:<file>[:<delayMs>]]
//
//   --seconds  Give up after this long. Default 90.
//   --press    Press Space once when the game reaches this phase (for example `ready`).
//   --until    Stop when the game reaches this phase. Default `results`.
//   --shot     Save a screenshot when the game reaches a phase, after an optional delay.
//
// The camera is always Chrome's fake camera, never the real one. Sound is muted.
// The game needs a dev server, for example: npx vite --port 5174 --strictPort
//
// Example: a simulated player on level 3, one player, starting 45 s into the song:
//   node scripts/smoke.mjs "http://localhost:5174/?input=bot&autostart=1&players=1&p0=3&start=45"
//
// Prints the phases the game went through, the final `window.__dance` state and any page errors.
// Exits 0 when the game reached the `--until` phase with no page error, else 1.

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Start Chrome and connect to its DevTools port ---

const port = 9300 + Math.floor(Math.random() * 600);
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'dance-smoke-'))}`,
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--window-size=1440,900',
    '--no-first-run',
    '--mute-audio',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

async function findPage() {
  for (let attempt = 0; attempt < 40; attempt++) {
    await sleep(250);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find((target) => target.type === 'page');
      if (page) return page;
    } catch {
      // Chrome is still starting.
    }
  }
  throw new Error('Chrome did not start.');
}

const socket = new WebSocket((await findPage()).webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener('open', resolve));

let nextId = 0;
const pending = new Map();
const pageErrors = [];

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message.result);
    pending.delete(message.id);
  }
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

function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const reply = await send('Runtime.evaluate', { expression, returnByValue: true });
  return reply.result?.value;
}

async function pressSpace() {
  const key = { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
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
let shotTaken = false;
let reached = false;
const startedMs = Date.now();
const elapsedSec = () => (Date.now() - startedMs) / 1000;

while (elapsedSec() < maxSeconds) {
  await sleep(POLL_MS);
  const phase = await evaluate('window.__dance?.phase');
  if (!phase) continue;
  if (phasesSeen.at(-1)?.phase !== phase) phasesSeen.push({ phase, atSec: elapsedSec().toFixed(1) });

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
console.log('final:', await evaluate('JSON.stringify(window.__dance)'));
console.log('errors:', pageErrors.length ? pageErrors : 'none');

socket.close();
chrome.kill();
process.exit(reached && pageErrors.length === 0 ? 0 : 1);
