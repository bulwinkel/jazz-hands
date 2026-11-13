import { errorText } from '../errorText';
import { MediaPipeTracker } from './trackers';
import type { LoadRequest, TrackRequest, WorkerAnswer, WorkerRequest } from './workerProtocol';

/**
 * A tracking worker. It holds one tracker, the same as the page would run, and tracks the
 * camera frames the page sends, so that inference never blocks the page's drawing. The page
 * decides which frames come; this side tracks each one it gets and answers.
 */

/** The parts of the worker's global scope in use here. The DOM types describe a page. */
interface WorkerScope {
  postMessage(answer: WorkerAnswer): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void;
}

const scope = self as unknown as WorkerScope;
let tracker: MediaPipeTracker | undefined;

scope.addEventListener('message', ({ data: request }) => {
  if (request.type === 'load') void load(request);
  else track(request);
});

async function load(request: LoadRequest): Promise<void> {
  const loading = new MediaPipeTracker(request.mode, { faces: request.faces });
  try {
    await loading.init();
    tracker = loading;
    scope.postMessage({ type: 'loaded', delegate: loading.delegate, faceDelegate: loading.faceDelegate });
  } catch (error) {
    loading.dispose();
    scope.postMessage({ type: 'loadFailed', error: errorText(error) });
  }
}

function track(request: TrackRequest): void {
  try {
    if (!tracker) throw new Error('Tracker is not ready.');
    // The page's time goes in and comes back out as the frame's time. This side never adds its own.
    const result = tracker.process(request.picture, request.timeMs, request.faceRegions);
    scope.postMessage({ type: 'tracked', frame: request.frame, result });
  } catch (error) {
    scope.postMessage({ type: 'trackFailed', frame: request.frame, error: errorText(error) });
  } finally {
    // A VideoFrame holds camera memory until it is closed.
    request.picture.close();
  }
}
