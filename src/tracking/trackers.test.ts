import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { GestureRecognizerResult } from '@mediapipe/tasks-vision';

const mocks = vi.hoisted(() => ({ gesture: vi.fn(), pose: vi.fn(), draw: vi.fn() }));
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: vi.fn().mockResolvedValue({}) },
  GestureRecognizer: { createFromOptions: mocks.gesture },
  PoseLandmarker: { createFromOptions: mocks.pose },
}));
import { createTracker } from './index';

function result(x: number): GestureRecognizerResult {
  return { landmarks: [Array.from({ length: 21 }, () => ({ x, y: 0.4, z: 0, visibility: 1 }))],
    worldLandmarks: [], handedness: [], handednesses: [], gestures: [[]] };
}
function recognizer(x: number) {
  return { recognizeForVideo: vi.fn().mockReturnValue(result(x)), close: vi.fn() };
}
const video = { videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0,
    getContext: () => ({ drawImage: mocks.draw }) }) });
});
afterEach(() => vi.unstubAllGlobals());

it('initializes once, accepts empty categories, and preserves synchronous full-frame output', async () => {
  const model = recognizer(0.8);
  mocks.gesture.mockResolvedValue(model);
  const tracker = createTracker('hands-full');
  const firstInit = tracker.init();
  expect(tracker.init()).toBe(firstInit);
  await firstInit;
  expect(mocks.gesture).toHaveBeenCalledTimes(1);
  expect(mocks.gesture.mock.calls[0][1]).toMatchObject({ runningMode: 'VIDEO', numHands: 4,
    baseOptions: { delegate: 'GPU', modelAssetPath: '/models/gesture_recognizer.task' } });
  const frame = tracker.process(video, 100);
  expect(frame.timeMs).toBe(100);
  expect(frame.players.map((player) => player.hands.length)).toEqual([1, 0]);
  expect(frame.players[0].hands[0].x).toBeCloseTo(0.2);
  expect(frame.players[0].hands[0].gesture).toBe('none');
  expect(model.recognizeForVideo).toHaveBeenCalledWith(video, 100);
  tracker.dispose();
  expect(model.close).toHaveBeenCalledTimes(1);
  expect(() => tracker.process(video, 200)).toThrow('Tracker is not ready.');
});

it('closes partial GPU initialization and uses CPU for both split recognizers', async () => {
  const gpu = recognizer(0.5), left = recognizer(0.5), right = recognizer(0.5);
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  mocks.gesture.mockResolvedValueOnce(gpu).mockRejectedValueOnce(new Error('No GPU'))
    .mockResolvedValueOnce(left).mockResolvedValueOnce(right);
  const tracker = createTracker('hands-split');
  await tracker.init();
  expect(tracker.delegate).toBe('CPU');
  expect(gpu.close).toHaveBeenCalledTimes(1);
  expect(mocks.gesture.mock.calls.map((call) => call[1].baseOptions.delegate)).toEqual(['GPU', 'GPU', 'CPU', 'CPU']);
  expect(mocks.gesture.mock.calls[0][1].canvas).not.toBe(mocks.gesture.mock.calls[1][1].canvas);
  const frame = tracker.process(video, 500);
  expect(frame.players.map((player) => player.hands[0].x)).toEqual([0.25, 0.75]);
  expect(mocks.draw.mock.calls.map((call) => call.slice(1, 5))).toEqual([[0, 0, 960, 1080], [960, 0, 960, 1080]]);
  tracker.dispose();
  expect(left.close).toHaveBeenCalledTimes(1); expect(right.close).toHaveBeenCalledTimes(1);
  warning.mockRestore();
});

it('uses the full pose model, falls back to CPU, and releases each inference result', async () => {
  const closeResult = vi.fn();
  const model = { detectForVideo: vi.fn().mockReturnValue({ landmarks: [], close: closeResult }), close: vi.fn() };
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  mocks.pose.mockRejectedValueOnce(new Error('No WebGL')).mockResolvedValueOnce(model);
  const tracker = createTracker('pose');
  await tracker.init();
  expect(tracker.delegate).toBe('CPU');
  expect(mocks.pose.mock.calls[1][1]).toMatchObject({ numPoses: 2, runningMode: 'VIDEO',
    baseOptions: { delegate: 'CPU', modelAssetPath: '/models/pose_landmarker_full.task' } });
  expect(tracker.process(video, 250).players).toEqual([{ hands: [] }, { hands: [] }]);
  expect(closeResult).toHaveBeenCalledTimes(1);
  tracker.dispose(); expect(model.close).toHaveBeenCalledTimes(1);
  warning.mockRestore();
});

it('closes a model that finishes initialization after disposal', async () => {
  let complete!: (model: ReturnType<typeof recognizer>) => void;
  mocks.gesture.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
  const tracker = createTracker('hands-full');
  const initialized = tracker.init();
  await Promise.resolve();
  tracker.dispose();
  const model = recognizer(0.5);
  complete(model);
  await expect(initialized).rejects.toThrow('Tracker is disposed.');
  expect(model.close).toHaveBeenCalledTimes(1);
  expect(tracker.delegate).toBe('uninitialized');
});
