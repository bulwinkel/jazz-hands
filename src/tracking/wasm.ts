import { FilesetResolver } from '@mediapipe/tasks-vision';
import { hasDocument } from './surfaces';

export type VisionRuntime = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

/** Where `scripts/setup-assets.mjs` puts the WASM runtime of MediaPipe. */
const WASM_FOLDER = '/vendor/tasks-vision-wasm';

let runtime: Promise<VisionRuntime> | undefined;

/** The WASM runtime of MediaPipe, from this server. Every model shares the one description. */
export function visionRuntime(): Promise<VisionRuntime> {
  runtime ??= hasDocument() ? FilesetResolver.forVisionTasks(WASM_FOLDER) : workerRuntime();
  return runtime;
}

/** The parts of the worker's global scope that MediaPipe's loader reads and writes. */
interface LoaderScope {
  import?: (url: string) => Promise<void>;
  ModuleFactory?: unknown;
}

/**
 * On the page, MediaPipe loads its WASM loader with a script tag. A worker has no document.
 * The tracking worker is a module worker, in `npm run dev` and in a build alike, and a module
 * worker cannot run `importScripts`. So the worker uses the loader that is built as a module.
 *
 * - The URL is absolute. The dev server refuses an import of a file in `public/` by its path.
 * - A module runs once per worker. Its code sets the global `ModuleFactory` the first time
 *   only, and MediaPipe clears that global after each model. MediaPipe calls `self.import`
 *   when it is there, so this hook sets the factory again for every model.
 */
function workerRuntime(): Promise<VisionRuntime> {
  const scope = self as unknown as LoaderScope;
  scope.import = async (url) => {
    const loader: { default: unknown } = await import(/* @vite-ignore */ url);
    scope.ModuleFactory = loader.default;
  };
  return FilesetResolver.forVisionTasks(`${self.location.origin}${WASM_FOLDER}`, true);
}
