import { MediaPipeTracker } from './trackers';
import type { LoadRequest, TrackRequest, WorkerAnswer, WorkerRequest } from './workerProtocol';

/**
 * The tracking worker. It runs the same trackers as the page, on the camera frames the page
 * sends, so that inference never blocks the page's drawing. The page decides which frames
 * come; this side tracks each one it gets and answers.
 */

/** The parts of the worker's global scope in use here. The DOM types describe a page. */
interface WorkerScope {
  postMessage(answer: WorkerAnswer): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void;
}

const scope = self as unknown as WorkerScope;
const trackers = new Map<number, MediaPipeTracker>();

scope.addEventListener('message', ({ data: request }) => {
  if (request.type === 'load') void load(request);
  else if (request.type === 'track') track(request);
  else dispose(request.tracker);
});

async function load(request: LoadRequest): Promise<void> {
  const tracker = new MediaPipeTracker(request.mode, { faces: request.faces });
  trackers.set(request.tracker, tracker);
  try {
    await tracker.init();
    scope.postMessage({
      type: 'loaded',
      tracker: request.tracker,
      delegate: tracker.delegate,
      faceDelegate: tracker.faceDelegate,
    });
  } catch (error) {
    dispose(request.tracker);
    scope.postMessage({ type: 'loadFailed', tracker: request.tracker, error: errorText(error) });
  }
}

function track(request: TrackRequest): void {
  try {
    const tracker = trackers.get(request.tracker);
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

function dispose(id: number): void {
  trackers.get(id)?.dispose();
  trackers.delete(id);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
