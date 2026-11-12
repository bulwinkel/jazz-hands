import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mediapipe = vi.hoisted(() => ({ gesture: vi.fn(), landmarks: vi.fn() }));
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: vi.fn().mockResolvedValue({}) },
  GestureRecognizer: { createFromOptions: mediapipe.gesture },
  HandLandmarker: { createFromOptions: mediapipe.landmarks },
}));
import { ZoneTracker } from './zones';

const VIDEO = { videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;
const ASPECT = 1920 / 1080;

interface RawPoint {
  x: number;
  y: number;
}

/**
 * The 21 landmarks of an open hand, fingers up, as a model reports them: fractions of the
 * picture it was shown, not mirrored. `x` is the position of the palm across that picture.
 */
function openHand(x: number, size = 0.1): RawPoint[] {
  const at = (across: number, up: number): RawPoint => ({ x: x + (across * size) / ASPECT, y: 0.6 - up * size });
  const finger = (across: number): RawPoint[] => [at(across, 1), at(across, 1.4), at(across, 1.7), at(across, 1.95)];
  const thumb = [at(-0.45, 0.3), at(-0.7, 0.55), at(-0.85, 0.75), at(-0.95, 0.9)];
  return [at(0, 0), ...thumb, ...finger(-0.3), ...finger(0), ...finger(0.25), ...finger(0.5)];
}

/** A stand-in for a gesture recognizer that finds the given hands in every picture. */
function recognizer(hands: RawPoint[][], label = 'Open_Palm') {
  const result = {
    landmarks: hands,
    gestures: hands.map(() => [{ categoryName: label, score: 0.9, index: -1, displayName: '' }]),
  };
  return { recognizeForVideo: vi.fn().mockReturnValue(result), close: vi.fn() };
}

/** A stand-in for a hand landmarker that finds the given hands in every picture. */
function landmarker(hands: RawPoint[][]) {
  return { detectForVideo: vi.fn().mockReturnValue({ landmarks: hands }), close: vi.fn() };
}

/** Every canvas the tracker made, with what was drawn on it and whether its WebGL context was given back. */
const canvases: { drawImage: ReturnType<typeof vi.fn>; loseContext: ReturnType<typeof vi.fn> }[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  canvases.length = 0;
  vi.stubGlobal('document', {
    createElement: () => {
      const drawImage = vi.fn();
      const loseContext = vi.fn();
      const canvas = {
        width: 0,
        height: 0,
        getContext: (kind: string) => (kind === '2d' ? { canvas, drawImage } : { getExtension: () => ({ loseContext }) }),
      };
      canvases.push({ drawImage, loseContext });
      return canvas;
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('one model on the full frame', () => {
  it('asks the model for two hands per zone', async () => {
    mediapipe.gesture.mockResolvedValue(recognizer([]));
    const tracker = new ZoneTracker({ zones: 3, layout: 'full', model: 'gesture' });
    await tracker.init();

    expect(mediapipe.gesture).toHaveBeenCalledTimes(1);
    expect(mediapipe.gesture.mock.calls[0][1]).toMatchObject({
      runningMode: 'VIDEO',
      numHands: 6,
      baseOptions: { delegate: 'GPU', modelAssetPath: '/models/gesture_recognizer.task' },
    });
    expect(tracker.delegate).toBe('GPU');
  });

  it('sorts the hands into zones of the mirrored frame', async () => {
    // Camera x 0.9 is on the left of the screen, camera x 0.1 on the right.
    const model = landmarker([openHand(0.9), openHand(0.1), openHand(0.15, 0.05)]);
    mediapipe.landmarks.mockResolvedValue(model);
    const tracker = new ZoneTracker({ zones: 4, layout: 'full', model: 'landmarks' });
    await tracker.init();

    const frame = tracker.process(VIDEO, 100);

    expect(model.detectForVideo).toHaveBeenCalledWith(VIDEO, 100);
    expect(frame.timeMs).toBe(100);
    expect(frame.zones.map((hands) => hands.length)).toEqual([1, 0, 0, 2]);
    expect(frame.zones[0][0].x).toBeCloseTo(0.1, 1);
    expect(frame.zoneInferenceMs).toBeUndefined();
  });

  it('reads the shape from the fingers and keeps the label of the gesture model beside it', async () => {
    mediapipe.gesture.mockResolvedValue(recognizer([openHand(0.5)], 'Closed_Fist'));
    const tracker = new ZoneTracker({ zones: 1, layout: 'full', model: 'gesture' });
    await tracker.init();

    const [hand] = tracker.process(VIDEO, 100).zones[0];

    expect(hand.gesture).toBe('open');
    expect(hand.modelGesture).toBe('fist');
    expect(hand.modelGestureScore).toBe(0.9);
  });

  it('gives no model label with the landmark model', async () => {
    mediapipe.landmarks.mockResolvedValue(landmarker([openHand(0.5)]));
    const tracker = new ZoneTracker({ zones: 1, layout: 'full', model: 'landmarks' });
    await tracker.init();

    const [hand] = tracker.process(VIDEO, 100).zones[0];

    expect(hand.gesture).toBe('open');
    expect(hand).not.toHaveProperty('modelGesture');
  });

  it('drops a hand that came without all its landmarks', async () => {
    mediapipe.landmarks.mockResolvedValue(landmarker([openHand(0.5).slice(0, 10)]));
    const tracker = new ZoneTracker({ zones: 2, layout: 'full', model: 'landmarks' });
    await tracker.init();

    expect(tracker.process(VIDEO, 100).zones).toEqual([[], []]);
  });
});

describe('one model per zone', () => {
  it('loads a model for every zone, each asked for two hands, each on its own canvas', async () => {
    mediapipe.landmarks.mockImplementation(async () => landmarker([]));
    const tracker = new ZoneTracker({ zones: 4, layout: 'crops', model: 'landmarks' });
    await tracker.init();

    const options = mediapipe.landmarks.mock.calls.map((call) => call[1]);
    expect(options).toHaveLength(4);
    expect(options.every((option) => option.numHands === 2)).toBe(true);
    expect(options[0].baseOptions.modelAssetPath).toBe('/models/hand_landmarker.task');
    expect(new Set(options.map((option) => option.canvas)).size).toBe(4);
  });

  it('shows each model the crop of its zone, the rightmost camera part for zone 0', async () => {
    mediapipe.landmarks.mockImplementation(async () => landmarker([]));
    const tracker = new ZoneTracker({ zones: 3, layout: 'crops', model: 'landmarks' });
    await tracker.init();

    const frame = tracker.process(VIDEO, 100);

    // The first three canvases belong to the models. The crops are drawn on the next three.
    const cropsDrawn = canvases.slice(3).map((canvas) => canvas.drawImage.mock.calls[0].slice(1, 5));
    expect(cropsDrawn).toEqual([
      [1216, 0, 704, 1080],
      [576, 0, 768, 1080],
      [0, 0, 704, 1080],
    ]);
    expect(frame.zoneInferenceMs).toHaveLength(3);
  });

  it('puts a hand from a crop at its place in the full frame', async () => {
    const zoneModels = [landmarker([]), landmarker([openHand(0.5)]), landmarker([])];
    zoneModels.forEach((model) => mediapipe.landmarks.mockResolvedValueOnce(model));
    const tracker = new ZoneTracker({ zones: 3, layout: 'crops', model: 'landmarks' });
    await tracker.init();

    const frame = tracker.process(VIDEO, 100);

    expect(frame.zones.map((hands) => hands.length)).toEqual([0, 1, 0]);
    expect(frame.zones[1][0].x).toBeCloseTo(0.5, 1);
    expect(frame.zones[1][0].gesture).toBe('open');
  });

  it('reports a hand in the overlap of two crops once, in the zone of its palm centre', async () => {
    // The crop of zone 0 shows camera pixels 1216 to 1920. Its left edge lies in zone 1.
    const inOverlapOfZone0 = openHand(0.03);
    // The same hand in the crop of zone 1, which shows camera pixels 576 to 1344.
    const sameHandInZone1 = openHand((1216 + 0.03 * 704 - 576) / 768);
    const zoneModels = [landmarker([inOverlapOfZone0]), landmarker([sameHandInZone1]), landmarker([])];
    zoneModels.forEach((model) => mediapipe.landmarks.mockResolvedValueOnce(model));
    const tracker = new ZoneTracker({ zones: 3, layout: 'crops', model: 'landmarks' });
    await tracker.init();

    expect(tracker.process(VIDEO, 100).zones.map((hands) => hands.length)).toEqual([0, 1, 0]);
  });
});

describe('loading and closing', () => {
  it('loads once, however often init is called', async () => {
    mediapipe.gesture.mockResolvedValue(recognizer([]));
    const tracker = new ZoneTracker({ zones: 2, layout: 'full', model: 'gesture' });

    expect(tracker.init()).toBe(tracker.init());
    await tracker.init();
    expect(mediapipe.gesture).toHaveBeenCalledTimes(1);
  });

  it('moves every model to the CPU when one cannot load on the GPU', async () => {
    const onGpu = landmarker([]);
    const onCpu = [landmarker([]), landmarker([])];
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mediapipe.landmarks
      .mockResolvedValueOnce(onGpu)
      .mockRejectedValueOnce(new Error('No GPU'))
      .mockResolvedValueOnce(onCpu[0])
      .mockResolvedValueOnce(onCpu[1]);
    const tracker = new ZoneTracker({ zones: 2, layout: 'crops', model: 'landmarks' });
    await tracker.init();

    const delegates = mediapipe.landmarks.mock.calls.map((call) => call[1].baseOptions.delegate);
    expect(delegates).toEqual(['GPU', 'GPU', 'CPU', 'CPU']);
    expect(onGpu.close).toHaveBeenCalledTimes(1);
    expect(tracker.delegate).toBe('CPU');
    warning.mockRestore();
  });

  it('closes its models and gives their WebGL contexts back when disposed', async () => {
    const model = recognizer([]);
    mediapipe.gesture.mockResolvedValue(model);
    const tracker = new ZoneTracker({ zones: 3, layout: 'full', model: 'gesture' });
    await tracker.init();

    tracker.dispose();

    expect(model.close).toHaveBeenCalledTimes(1);
    expect(canvases[0].loseContext).toHaveBeenCalledTimes(1);
    expect(tracker.delegate).toBe('uninitialized');
    expect(() => tracker.process(VIDEO, 200)).toThrow('The zone tracker is not ready.');
    await expect(tracker.init()).rejects.toThrow('The zone tracker is disposed.');
  });

  it('closes a model that finishes loading after the tracker was disposed', async () => {
    let finishLoading!: (model: ReturnType<typeof recognizer>) => void;
    mediapipe.gesture.mockImplementationOnce(() => new Promise((resolve) => (finishLoading = resolve)));
    const tracker = new ZoneTracker({ zones: 3, layout: 'full', model: 'gesture' });
    const loaded = tracker.init();
    await Promise.resolve();

    tracker.dispose();
    const lateModel = recognizer([]);
    finishLoading(lateModel);

    await expect(loaded).rejects.toThrow('The zone tracker is disposed.');
    expect(lateModel.close).toHaveBeenCalledTimes(1);
    expect(mediapipe.gesture).toHaveBeenCalledTimes(1);
  });

  it.each([0, 5, 2.5])('refuses %d zones', (zones) => {
    expect(() => new ZoneTracker({ zones, layout: 'full', model: 'gesture' })).toThrow(RangeError);
  });

  it('refuses a video with no picture', async () => {
    mediapipe.gesture.mockResolvedValue(recognizer([]));
    const tracker = new ZoneTracker({ zones: 3, layout: 'full', model: 'gesture' });
    await tracker.init();

    const noPicture = { videoWidth: 0, videoHeight: 0 } as HTMLVideoElement;
    expect(() => tracker.process(noPicture, 100)).toThrow('The camera has no picture yet.');
  });
});
