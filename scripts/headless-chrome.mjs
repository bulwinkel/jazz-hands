// Starts headless Chrome for automated checks and connects to its page over the DevTools
// protocol. The camera is always a fake one, never the real one, and sound is muted.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/** The video files Chrome can play as a fake camera. */
export const CAMERA_FILE_TYPES = ['.y4m', '.mjpeg'];

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Opens headless Chrome on about:blank.
 *
 * - `windowSize`: '<width>x<height>'.
 * - `cameraFile`: a .y4m or .mjpeg file that Chrome plays as the camera, in a loop. Without it,
 *   the camera is Chrome's built-in test picture, which shows no hands.
 *
 * Returns `send` and `evaluate` for the page, `watchErrors` for the errors of the page and its
 * workers, `pressSpace`, `onEvent` for its DevTools events, and `close`.
 */
export async function openHeadlessChrome({ windowSize = '1440x900', cameraFile } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'dance-smoke-'));
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      // Port 0: Chrome picks a free port and writes it into the profile. A random port can be
      // taken by another Chrome, and the script would then drive someone else's page.
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      ...(cameraFile ? [`--use-file-for-fake-video-capture=${checkedCameraFile(cameraFile)}`] : []),
      `--window-size=${windowSize.replace('x', ',')}`,
      '--no-first-run',
      '--mute-audio',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  try {
    const port = await devToolsPort(profile);
    const page = await findPage(port);
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((done, fail) => {
      socket.addEventListener('open', done);
      socket.addEventListener('error', () => fail(new Error('Cannot connect to the Chrome page.')));
    });
    return connect(socket, chrome);
  } catch (error) {
    chrome.kill();
    throw error;
  }
}

/** The camera file as an absolute path. Chrome needs one of the types it can play. */
function checkedCameraFile(path) {
  const absolute = resolve(path);
  if (!existsSync(absolute)) throw new Error(`No camera file at ${absolute}`);
  if (!CAMERA_FILE_TYPES.includes(extname(absolute).toLowerCase())) {
    throw new Error(`Chrome plays only ${CAMERA_FILE_TYPES.join(' and ')} files as a camera: ${absolute}`);
  }
  return absolute;
}

/** Chrome writes its DevTools port into the first line of this file once it listens. */
async function devToolsPort(profile) {
  const file = join(profile, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 100; attempt++) {
    await sleep(100);
    if (existsSync(file)) {
      const port = Number(readFileSync(file, 'utf8').split('\n')[0]);
      if (port > 0) return port;
    }
  }
  throw new Error('Chrome did not start.');
}

async function findPage(port) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find((target) => target.type === 'page');
      if (page) return page;
    } catch {
      // Chrome is still starting.
    }
    await sleep(250);
  }
  throw new Error('Chrome has no page.');
}

function connect(socket, chrome) {
  let nextId = 0;
  const pending = new Map();
  const listeners = [];

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message.result);
      pending.delete(message.id);
    }
    if (message.method) for (const listener of listeners) listener(message);
  });

  /** Sends a DevTools command to the page, or to a worker of it with that worker's `sessionId`. */
  function send(method, params = {}, sessionId) {
    return new Promise((done) => {
      nextId++;
      pending.set(nextId, done);
      socket.send(JSON.stringify({ id: nextId, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  async function evaluate(expression) {
    const reply = await send('Runtime.evaluate', { expression, returnByValue: true });
    return reply?.result?.value;
  }

  /**
   * Collects the errors of the page and of its workers: uncaught exceptions and console.error
   * lines. Call it before the page loads. Returns the list, which fills as errors come.
   */
  async function watchErrors() {
    const errors = [];
    listeners.push((message) => {
      const where = message.sessionId ? 'worker: ' : '';
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails;
        errors.push(`${where}${details.exception?.description ?? details.text}`);
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        const text = message.params.args.map((arg) => arg.value ?? arg.description).join(' ');
        // MediaPipe writes its INFO lines through console.error. They are not errors.
        if (!text.startsWith('INFO:')) errors.push(`${where}console.error: ${text}`);
      }
      if (message.method === 'Target.attachedToTarget') {
        // A new worker waits for the debugger, so that no early error goes unseen.
        const { sessionId } = message.params;
        void send('Runtime.enable', {}, sessionId).then(() => send('Runtime.runIfWaitingForDebugger', {}, sessionId));
      }
    });
    await send('Runtime.enable');
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    return errors;
  }

  async function pressSpace() {
    const key = { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 };
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  }

  return {
    send,
    evaluate,
    watchErrors,
    pressSpace,
    /** Calls `listener` with every DevTools event of the page and its workers: `{ method, params, sessionId }`. */
    onEvent: (listener) => listeners.push(listener),
    close() {
      socket.close();
      chrome.kill();
    },
  };
}
