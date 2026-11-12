/// <reference types="node" />
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

/** Local dev output only. Production builds do not expose this endpoint. */
function trackingResults(): Plugin {
  return {
    name: 'tracking-results',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== '/__tracking-results') { next(); return; }
        const reply = (status: number, body: object) => {
          response.statusCode = status;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.end(JSON.stringify(body));
        };
        if (request.method !== 'POST') {
          response.setHeader('Allow', 'POST');
          reply(405, { error: 'Use POST.' }); return;
        }
        if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
          reply(415, { error: 'Content-Type must be application/json.' }); return;
        }
        const limit = 1024 * 1024;
        if (Number(request.headers['content-length']) > limit) {
          reply(413, { error: 'JSON body exceeds 1 MB.' }); return;
        }
        let bytes = 0;
        let chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => {
          if (response.writableEnded) return;
          bytes += chunk.length;
          if (bytes > limit) { chunks = []; reply(413, { error: 'JSON body exceeds 1 MB.' }); }
          else chunks.push(chunk);
        });
        request.on('error', () => {
          if (!response.writableEnded) reply(400, { error: 'Cannot read the JSON body.' });
        });
        request.on('end', () => {
          if (response.writableEnded) return;
          let json: unknown;
          try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
          catch { reply(400, { error: 'Invalid JSON.' }); return; }
          void (async () => {
            const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
            const folder = resolve(server.config.root, 'test-results');
            const path = resolve(folder, `tracking-${stamp}.json`);
            try {
              await mkdir(folder, { recursive: true });
              await writeFile(path, `${JSON.stringify(json, null, 2)}\n`, { flag: 'wx' });
              reply(201, { path });
            } catch (error) {
              const collision = (error as NodeJS.ErrnoException).code === 'EEXIST';
              reply(collision ? 409 : 500, { error: collision
                ? 'A result already exists for this second. Retry the POST.' : 'Cannot save the result file.' });
            }
          })();
        });
      });
    },
  };
}

// Multi-page app. Add each new top-level HTML page to `input`.
export default defineConfig({
  plugins: [trackingResults()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        trackerTest: 'tracker-test.html',
      },
    },
  },
});
