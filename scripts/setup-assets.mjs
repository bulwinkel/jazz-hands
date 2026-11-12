// Copies the MediaPipe WASM runtime and downloads the model files into public/,
// so the game runs with no network connection after the first setup.
// Safe to run again: it skips files that already exist.
import { cp, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDest = join(root, 'public/vendor/tasks-vision-wasm');
const modelDir = join(root, 'public/models');
const base = 'https://storage.googleapis.com/mediapipe-models';

const models = {
  'gesture_recognizer.task': `${base}/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task`,
  'hand_landmarker.task': `${base}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
  'pose_landmarker_lite.task': `${base}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
  'pose_landmarker_full.task': `${base}/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task`,
  'face_landmarker.task': `${base}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
};

const exists = (path) => stat(path).then((s) => s.size > 0, () => false);

await mkdir(wasmDest, { recursive: true });
await cp(wasmSrc, wasmDest, { recursive: true });

await mkdir(modelDir, { recursive: true });
for (const [name, url] of Object.entries(models)) {
  const dest = join(modelDir, name);
  if (await exists(dest)) continue;
  console.log(`Downloading ${name}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed for ${name}: HTTP ${res.status}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}
console.log('MediaPipe assets ready.');
