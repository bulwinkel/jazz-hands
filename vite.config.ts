/// <reference types="node" />
import { mkdir, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

/**
 * Dev-server routes that save a posted JSON body into `test-results/`, as a new file named by
 * this prefix and the time.
 */
const SAVE_ROUTES: Record<string, { prefix: string }> = {
  '/__tracking-results': { prefix: 'tracking' },
  '/__run-diagnostics': { prefix: 'run' },
};

/** The largest JSON body that a route takes. */
const BODY_LIMIT_BYTES = 4 * 1024 * 1024;

/** A request that the server refuses, with the status and the reason it answers. */
class Refusal extends Error {
  readonly status: number;

  constructor(status: number, reason: string) {
    super(reason);
    this.status = status;
  }
}

/** Local dev output only. Production builds do not expose these routes. */
function saveResults(): Plugin {
  return {
    name: 'tracking-results',
    apply: 'serve',
    configureServer(server) {
      const folder = resolve(server.config.root, 'test-results');
      server.middlewares.use((request, response, next) => {
        const route = SAVE_ROUTES[request.url?.split('?')[0] ?? ''];
        if (!route) {
          next();
          return;
        }
        void handleSave(request, response, folder, route.prefix);
      });
    },
  };
}

/** Saves the JSON body of a POST, and answers with the path of the file it wrote. */
async function handleSave(
  request: IncomingMessage,
  response: ServerResponse,
  folder: string,
  prefix: string,
): Promise<void> {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    reply(response, 405, { error: 'Use POST.' });
    return;
  }
  try {
    checkHeaders(request);
    const json = await readJsonBody(request);
    await mkdir(folder, { recursive: true });
    const path = await saveNewFile(folder, prefix, json);
    reply(response, 201, { path });
  } catch (error) {
    if (error instanceof Refusal) reply(response, error.status, { error: error.message });
    else reply(response, 500, { error: 'Cannot save the result file.' });
  }
}

/** Refuses a body that is not JSON, or that says it is too large, before reading it. */
function checkHeaders(request: IncomingMessage): void {
  const type = request.headers['content-type']?.split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new Refusal(415, 'Content-Type must be application/json.');
  if (Number(request.headers['content-length']) > BODY_LIMIT_BYTES) throw tooLarge();
}

function tooLarge(): Refusal {
  return new Refusal(413, 'JSON body exceeds 4 MB.');
}

/**
 * Reads and parses the body. A body that grows past the limit is refused as soon as it does,
 * and the rest of it is ignored.
 */
function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    request.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > BODY_LIMIT_BYTES) fail(tooLarge());
      else chunks.push(chunk);
    });
    request.on('error', () => fail(new Refusal(400, 'Cannot read the JSON body.')));
    request.on('end', () => {
      try {
        done(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        fail(new Refusal(400, 'Invalid JSON.'));
      }
    });
  });
}

/**
 * Writes `json` to a new file `<prefix>-<time>.json`, and gives its path. The time has whole
 * seconds: a second save in the same second is refused, never written over the first.
 */
async function saveNewFile(folder: string, prefix: string, json: unknown): Promise<string> {
  const path = resolve(folder, `${prefix}-${timeStamp()}.json`);
  try {
    await writeFile(path, `${JSON.stringify(json, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Refusal(409, 'A result already exists for this second. Retry the POST.');
    }
    throw error;
  }
  return path;
}

/** The time now, for example `20261113-083015`. */
function timeStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
}

/** Answers with `body` as JSON, unless the server has answered already. */
function reply(response: ServerResponse, status: number, body: object): void {
  if (response.writableEnded) return;
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

// Multi-page app. Add each new top-level HTML page to `input`.
export default defineConfig({
  plugins: [saveResults()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        trackerTest: 'tracker-test.html',
        zoneTest: 'zone-test.html',
      },
    },
  },
});
