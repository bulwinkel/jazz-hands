// Decodes one audio file in headless Chrome, the way the game does, and prints what Chrome heard.
// tools/songs/add_song.py compares these numbers with ffmpeg's decode of the same file,
// because the two decoders do not always put the first sample at the same time.
//
// Usage:
//   node tools/songs/chrome_decode.mjs <audio file> --rate=48000 --windows=20,60,100
//
//   --rate     Sample rate to decode at, in Hz. Give the file's own rate, so nothing is resampled.
//   --windows  Start times, in whole seconds, of the 1 s windows to take a landmark from.
//
// A landmark is the time of the largest sample of channel 0 in one window:
// the largest value, not the largest magnitude.
//
// Prints one line of JSON:
//   {"durationSec":204.76,"sampleRate":48000,"channels":2,
//    "landmarks":[{"windowStartSec":20,"peakSec":20.412354,"peakLevel":0.61}]}
//
// It needs no dev server: it serves the file itself on a free local port.
// It uses no camera and plays no sound: the decode runs in an OfflineAudioContext.
// Exits 0 with the JSON on stdout, or 1 with one line on stderr.

import { spawn } from 'node:child_process';
import { createReadStream, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LANDMARK_WINDOW_SEC = 1;
const POLL_MS = 100;
/** Chrome needs a few seconds to start. A song decodes in about one second. */
const CHROME_START_MS = 15_000;
const TOTAL_MS = 90_000;

const USAGE = 'Usage: node tools/songs/chrome_decode.mjs <audio file> --rate=<Hz> --windows=<sec>,<sec>,...';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Returns { audioPath, sampleRate, windowStartsSec }, or throws the usage text. */
function readArguments(argv) {
  const [audioPath, ...flags] = argv;
  const flag = (name) => flags.find((f) => f.startsWith(`--${name}=`))?.slice(name.length + 3);
  const sampleRate = Number(flag('rate'));
  const windowStartsSec = (flag('windows') ?? '').split(',').filter(Boolean).map(Number);

  const valid =
    audioPath &&
    Number.isInteger(sampleRate) &&
    sampleRate > 0 &&
    windowStartsSec.length > 0 &&
    windowStartsSec.every((start) => Number.isInteger(start) && start >= 0);
  if (!valid) throw new Error(USAGE);
  return { audioPath, sampleRate, windowStartsSec };
}

/**
 * Serves an empty page at `/` and the audio file at `/audio`, on a free port of this machine only.
 * The page gives the decode a real origin, so its `fetch` of the file is same-origin.
 */
async function startFileServer(audioPath) {
  const audioBytes = statSync(audioPath).size;
  const server = createServer((request, response) => {
    if (request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><title>decode</title>');
    } else if (request.url === '/audio') {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': audioBytes });
      createReadStream(audioPath).pipe(response);
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

/** Starts headless Chrome with a throwaway profile. Chrome picks its own free DevTools port. */
function startChrome(profileDir) {
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--mute-audio',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const exited = new Promise((resolve) => {
    chrome.once('exit', resolve);
    chrome.once('error', resolve);
  });
  return { chrome, exited };
}

/** Chrome writes its DevTools port to a file in the profile once it listens. Returns that port. */
async function findDevToolsPort(profileDir) {
  const portFile = join(profileDir, 'DevToolsActivePort');
  for (let waitedMs = 0; waitedMs < CHROME_START_MS; waitedMs += POLL_MS) {
    await sleep(POLL_MS);
    try {
      const port = Number(readFileSync(portFile, 'utf8').split('\n')[0]);
      if (port > 0) return port;
    } catch {
      // Chrome is still starting.
    }
  }
  throw new Error(`Chrome did not start. Expected it at ${CHROME}`);
}

/** Connects to the DevTools socket of Chrome's one page. Returns `send(method, params)`. */
async function connectToPage(devToolsPort) {
  const targets = await (await fetch(`http://127.0.0.1:${devToolsPort}/json`)).json();
  const page = targets.find((target) => target.type === 'page');
  if (!page) throw new Error('Chrome opened no page.');

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve);
    socket.addEventListener('error', () => reject(new Error('Cannot connect to Chrome.')));
  });

  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message.result ?? {});
      pending.delete(message.id);
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
  return { socket, send };
}

/**
 * Runs inside the page. Decodes `/audio` as the game does, then takes one landmark per window.
 * It must not use anything from this file: Chrome receives only its source text.
 */
async function measureInPage({ sampleRate, windowStartsSec, windowSec }) {
  const response = await fetch('/audio');
  const context = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate });
  const buffer = await context.decodeAudioData(await response.arrayBuffer());
  const samples = buffer.getChannelData(0);

  const landmarks = windowStartsSec.map((windowStartSec) => {
    const from = windowStartSec * buffer.sampleRate;
    const to = Math.min(samples.length, from + windowSec * buffer.sampleRate);
    let peakIndex = from;
    let peakLevel = -Infinity;
    for (let i = from; i < to; i++) {
      if (samples[i] > peakLevel) {
        peakLevel = samples[i];
        peakIndex = i;
      }
    }
    return { windowStartSec, peakSec: peakIndex / buffer.sampleRate, peakLevel };
  });

  return {
    durationSec: buffer.duration,
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
    landmarks,
  };
}

/** Loads the empty page and waits until the page's origin is the server's, so `/audio` resolves. */
async function loadPage(send, origin) {
  await send('Page.enable');
  await send('Page.navigate', { url: `${origin}/` });
  for (let waitedMs = 0; waitedMs < CHROME_START_MS; waitedMs += POLL_MS) {
    const reply = await send('Runtime.evaluate', { expression: 'location.origin', returnByValue: true });
    if (reply.result?.value === origin) return;
    await sleep(POLL_MS);
  }
  throw new Error('Chrome did not load the page.');
}

/** Runs `measureInPage` in the loaded page and returns its result. */
async function decodeInChrome(send, origin, options) {
  await loadPage(send, origin);
  const reply = await send('Runtime.evaluate', {
    expression: `(${measureInPage})(${JSON.stringify(options)})`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (reply.exceptionDetails) {
    const reason = reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text;
    throw new Error(`Chrome cannot decode this file, so the game cannot play it. ${reason}`);
  }
  return reply.result.value;
}

/** Decodes the file named on the command line. Leaves no server, browser or profile behind. */
async function main() {
  const { audioPath, sampleRate, windowStartsSec } = readArguments(process.argv.slice(2));
  const profileDir = mkdtempSync(join(tmpdir(), 'add-song-chrome-'));
  let server;
  let browser;
  let socket;

  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Chrome took too long.')), TOTAL_MS).unref();
  });

  const decode = async () => {
    server = await startFileServer(audioPath);
    browser = startChrome(profileDir);
    const page = await connectToPage(await findDevToolsPort(profileDir));
    socket = page.socket;
    const origin = `http://127.0.0.1:${server.address().port}`;
    return decodeInChrome(page.send, origin, { sampleRate, windowStartsSec, windowSec: LANDMARK_WINDOW_SEC });
  };

  try {
    return await Promise.race([decode(), timeout]);
  } finally {
    socket?.close();
    server?.close();
    server?.closeAllConnections();
    if (browser) {
      browser.chrome.kill();
      await browser.exited;
    }
    rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

try {
  console.log(JSON.stringify(await main()));
  process.exit(0);
} catch (error) {
  console.error(`chrome_decode: ${error.message}`);
  process.exit(1);
}
