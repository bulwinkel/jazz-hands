import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision';

const mocks = vi.hoisted(() => ({ gesture: vi.fn(), pose: vi.fn(), face: vi.fn(), draw: vi.fn() }));
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: vi.fn().mockResolvedValue({}) },
  GestureRecognizer: { createFromOptions: mocks.gesture },
  PoseLandmarker: { createFromOptions: mocks.pose },
  FaceLandmarker: { createFromOptions: mocks.face },
}));
import { TRACKER_MODES } from './config';
import { createTracker } from './index';
import type { FaceRegions, Tracker, TrackerMode } from './types';

const video = { videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;
const NO_HANDS = { landmarks: [], worldLandmarks: [], handedness: [], handednesses: [], gestures: [] };

/** A face model result: one smiling face in the middle of the crop. */
function smilingFace(): FaceLandmarkerResult {
  const landmark = (x: number, y: number) => ({ x, y, z: 0, visibility: 1 });
  const blendshape = (categoryName: string, score: number) => ({ categoryName, score, index: 0, displayName: '' });
  return {
    faceLandmarks: [[landmark(0.4, 0.3), landmark(0.6, 0.7)]],
    faceBlendshapes: [
      {
        categories: [blendshape('mouthSmileLeft', 0.8), blendshape('mouthSmileRight', 0.6), blendshape('jawOpen', 0.2)],
        headIndex: 0,
        headName: '',
      },
    ],
    facialTransformationMatrixes: [],
  };
}

const NO_FACE: FaceLandmarkerResult = { faceLandmarks: [], faceBlendshapes: [], facialTransformationMatrixes: [] };

function faceModel(result: FaceLandmarkerResult = smilingFace()) {
  return { detectForVideo: vi.fn().mockReturnValue(result), close: vi.fn() };
}

/** Makes every model load, and returns the two face models in player-slot order. */
function loadAllModels() {
  const faces = [faceModel(), faceModel()];
  mocks.gesture.mockResolvedValue({ recognizeForVideo: vi.fn().mockReturnValue(NO_HANDS), close: vi.fn() });
  mocks.pose.mockResolvedValue({
    detectForVideo: vi.fn().mockReturnValue({ landmarks: [], close: vi.fn() }),
    close: vi.fn(),
  });
  mocks.face.mockResolvedValueOnce(faces[0]).mockResolvedValueOnce(faces[1]);
  return faces;
}

/**
 * A loaded tracker with faces. It forgets the warm-up run of each face model,
 * so a test counts only the runs it causes.
 */
async function loadedTracker(mode: TrackerMode, faces: ReturnType<typeof faceModel>[]): Promise<Tracker> {
  const tracker = createTracker(mode, { faces: true });
  await tracker.init();
  for (const model of faces) model.detectForVideo.mockClear();
  return tracker;
}

const RIGHT_PLAYER_ONLY: FaceRegions = [null, { x: 0.6, y: 0.1, width: 0.3, height: 0.5 }];
const BOTH_PLAYERS: FaceRegions = [
  { x: 0.1, y: 0.1, width: 0.3, height: 0.5 },
  { x: 0.6, y: 0.1, width: 0.3, height: 0.5 },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: mocks.draw, fillRect: vi.fn() }),
    }),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('a tracker created without faces', () => {
  it('loads no face model and does no face work, even when given a region', async () => {
    loadAllModels();
    const tracker = createTracker('hands-full');
    await tracker.init();

    const frame = tracker.process(video, 100, RIGHT_PLAYER_ONLY);

    expect(mocks.face).not.toHaveBeenCalled();
    expect(mocks.draw).not.toHaveBeenCalled();
    expect(frame.players).toEqual([{ hands: [] }, { hands: [] }]);
    expect(tracker.faceDelegate).toBe('uninitialized');
  });
});

describe('a tracker created with faces', () => {
  it('loads one face model per player slot, each on its own GPU canvas', async () => {
    loadAllModels();
    const tracker = createTracker('hands-full', { faces: true });
    await tracker.init();

    expect(mocks.face).toHaveBeenCalledTimes(2);
    for (const [, options] of mocks.face.mock.calls) {
      expect(options).toMatchObject({
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
        baseOptions: { delegate: 'GPU', modelAssetPath: '/models/face_landmarker.task' },
      });
    }
    const [firstCanvas, secondCanvas] = mocks.face.mock.calls.map(([, options]) => options.canvas);
    expect(firstCanvas).toBeDefined();
    expect(firstCanvas).not.toBe(secondCanvas);
    expect(firstCanvas).not.toBe(mocks.gesture.mock.calls[0][1].canvas);
    expect(tracker.faceDelegate).toBe('GPU');
  });

  it('runs each face model once while it loads, so the first face cue causes no freeze', async () => {
    const faces = loadAllModels();
    const tracker = createTracker('hands-full', { faces: true });
    await tracker.init();

    for (const model of faces) {
      expect(model.detectForVideo).toHaveBeenCalledTimes(1);
      const [picture] = model.detectForVideo.mock.calls[0];
      expect(picture).toMatchObject({ width: 256, height: 256 });
    }
    expect(mocks.draw).not.toHaveBeenCalled(); // The warm-up reads no camera frame.
    tracker.dispose();
  });

  it('does no face work when no region is given', async () => {
    const faces = loadAllModels();
    const tracker = await loadedTracker('hands-full', faces);

    const withoutRegions = tracker.process(video, 100);
    const withNullRegions = tracker.process(video, 200, [null, null]);

    expect(faces[0].detectForVideo).not.toHaveBeenCalled();
    expect(faces[1].detectForVideo).not.toHaveBeenCalled();
    expect(mocks.draw).not.toHaveBeenCalled();
    expect(withoutRegions.players[0].face).toBeUndefined();
    expect(withNullRegions.players[1].face).toBeUndefined();
  });

  it('crops the region from the raw frame and maps the face back to the mirrored frame', async () => {
    const faces = loadAllModels();
    const tracker = await loadedTracker('hands-full', faces);

    const frame = tracker.process(video, 100, RIGHT_PLAYER_ONLY);

    // The display region 0.6..0.9 is the raw frame's 0.1..0.4: 192 px to 768 px.
    expect(mocks.draw).toHaveBeenCalledTimes(1);
    expect(mocks.draw).toHaveBeenCalledWith(video, 192, 108, 576, 540, 0, 0, 576, 540);
    expect(faces[0].detectForVideo).not.toHaveBeenCalled();
    expect(faces[1].detectForVideo).toHaveBeenCalledTimes(1);
    const [crop, timestamp] = faces[1].detectForVideo.mock.calls[0];
    expect(crop).toMatchObject({ width: 576, height: 540 });
    expect(timestamp).toBe(100);

    expect(frame.players[0].face).toBeUndefined();
    const face = frame.players[1].face;
    expect(face?.x).toBeCloseTo(0.75); // The middle of the region.
    expect(face?.y).toBeCloseTo(0.35);
    expect(face?.expressions.smile).toBeCloseTo(0.7);
    expect(face?.expressions.openMouth).toBeCloseTo(0.2);
    expect(face?.expressions.pucker).toBe(0);
  });

  it('gives no face when the model finds none in the region', async () => {
    const faces = loadAllModels();
    faces[0].detectForVideo.mockReturnValue(NO_FACE);
    const tracker = await loadedTracker('hands-full', faces);

    const frame = tracker.process(video, 100, [{ x: 0.1, y: 0.1, width: 0.3, height: 0.5 }, null]);

    expect(faces[0].detectForVideo).toHaveBeenCalledTimes(1);
    expect(frame.players[0].face).toBeUndefined();
  });

  it.each(TRACKER_MODES)('reads faces the same way in %s mode', async (mode) => {
    loadAllModels();
    const tracker = createTracker(mode, { faces: true });
    await tracker.init();

    const frame = tracker.process(video, 100, RIGHT_PLAYER_ONLY);

    expect(frame.players[0].face).toBeUndefined();
    expect(frame.players[1].face?.x).toBeCloseTo(0.75);
    expect(frame.players[1].face?.expressions.smile).toBeCloseTo(0.7);
  });

  it('counts the face work in the inference time', async () => {
    const faces = loadAllModels();
    let clockMs = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clockMs);
    faces[1].detectForVideo.mockImplementation(() => {
      clockMs += 7;
      return smilingFace();
    });
    const tracker = createTracker('hands-full', { faces: true });
    await tracker.init();

    expect(tracker.process(video, 100, RIGHT_PLAYER_ONLY).inferenceMs).toBe(7);
    vi.restoreAllMocks();
  });

  it('uses the CPU for both face models when the GPU fails, and closes the model that had loaded', async () => {
    const [onGpu, firstOnCpu, secondOnCpu] = [faceModel(), faceModel(), faceModel()];
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.gesture.mockResolvedValue({ recognizeForVideo: vi.fn().mockReturnValue(NO_HANDS), close: vi.fn() });
    mocks.face
      .mockResolvedValueOnce(onGpu)
      .mockRejectedValueOnce(new Error('No GPU'))
      .mockResolvedValueOnce(firstOnCpu)
      .mockResolvedValueOnce(secondOnCpu);
    const tracker = createTracker('hands-full', { faces: true });
    await tracker.init();

    expect(onGpu.close).toHaveBeenCalledTimes(1);
    expect(mocks.face.mock.calls.map(([, options]) => options.baseOptions.delegate)).toEqual(['GPU', 'GPU', 'CPU', 'CPU']);
    expect(tracker.faceDelegate).toBe('CPU');
    expect(tracker.delegate).toBe('GPU'); // The hand models keep the GPU.
    expect(tracker.process(video, 100, RIGHT_PLAYER_ONLY).players[1].face).toBeDefined();
    warning.mockRestore();
  });

  it('fails to initialize when the face model cannot load at all', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.gesture.mockResolvedValue({ recognizeForVideo: vi.fn().mockReturnValue(NO_HANDS), close: vi.fn() });
    mocks.face.mockRejectedValue(new Error('Model file is missing'));
    const tracker = createTracker('hands-full', { faces: true });

    await expect(tracker.init()).rejects.toThrow('Model file is missing');
    expect(tracker.faceDelegate).toBe('uninitialized');
    warning.mockRestore();
  });

  it('closes the face models on dispose', async () => {
    const faces = loadAllModels();
    const tracker = createTracker('hands-split', { faces: true });
    await tracker.init();
    tracker.dispose();

    expect(faces[0].close).toHaveBeenCalledTimes(1);
    expect(faces[1].close).toHaveBeenCalledTimes(1);
    expect(tracker.faceDelegate).toBe('uninitialized');
    expect(() => tracker.process(video, 100, RIGHT_PLAYER_ONLY)).toThrow('Tracker is not ready.');
  });

  it('closes a face model that finishes loading after disposal', async () => {
    mocks.gesture.mockResolvedValue({ recognizeForVideo: vi.fn().mockReturnValue(NO_HANDS), close: vi.fn() });
    let finishLoading!: (model: ReturnType<typeof faceModel>) => void;
    const loading = new Promise<ReturnType<typeof faceModel>>((resolve) => {
      finishLoading = resolve;
    });
    mocks.face.mockReturnValueOnce(loading);
    const tracker = createTracker('hands-full', { faces: true });
    const initialized = tracker.init();
    await vi.waitFor(() => expect(mocks.face).toHaveBeenCalledTimes(1));

    tracker.dispose();
    const lateModel = faceModel();
    finishLoading(lateModel);

    await expect(initialized).rejects.toThrow('Tracker is disposed.');
    expect(lateModel.close).toHaveBeenCalledTimes(1);
  });
});

describe('two faces asked for at once', () => {
  /** The frame times at which a face model ran. */
  const runTimes = (model: ReturnType<typeof faceModel>): number[] =>
    model.detectForVideo.mock.calls.map(([, timestamp]) => timestamp);

  it('reads one face per frame, in turns', async () => {
    const faces = loadAllModels();
    const tracker = await loadedTracker('hands-full', faces);

    for (const nowMs of [100, 133, 166, 200]) tracker.process(video, nowMs, BOTH_PLAYERS);

    expect(runTimes(faces[0])).toEqual([100, 166]);
    expect(runTimes(faces[1])).toEqual([133, 200]);
    expect(mocks.draw).toHaveBeenCalledTimes(4); // One crop per frame, not two.
  });

  it('gives the other player the face from their last turn', async () => {
    const faces = loadAllModels();
    const tracker = await loadedTracker('hands-full', faces);

    const first = tracker.process(video, 100, BOTH_PLAYERS);
    const second = tracker.process(video, 133, BOTH_PLAYERS);
    const third = tracker.process(video, 166, BOTH_PLAYERS);

    // Player 1 has had no turn yet in the first frame.
    expect(first.players[0].face).toBeDefined();
    expect(first.players[1].face).toBeUndefined();
    expect(second.players[1].face).toBeDefined();
    expect(second.players[0].face).toBe(first.players[0].face);
    expect(third.players[0].face).not.toBe(first.players[0].face);
    expect(third.players[1].face).toBe(second.players[1].face);
  });

  it('keeps a face from the last turn for 100 ms, and no longer', async () => {
    const faces = loadAllModels();
    const tracker = await loadedTracker('hands-full', faces);

    tracker.process(video, 1000, BOTH_PLAYERS); // Reads player 0.
    const justInTime = tracker.process(video, 1100, BOTH_PLAYERS); // Reads player 1.
    expect(justInTime.players[0].face).toBeDefined();

    tracker.process(video, 2000, BOTH_PLAYERS); // Reads player 0.
    const tooLate = tracker.process(video, 2101, BOTH_PLAYERS); // Reads player 1.
    expect(tooLate.players[0].face).toBeUndefined();
    expect(tooLate.players[1].face).toBeDefined();
  });

  it('gives no face when the last turn found none', async () => {
    const faces = loadAllModels();
    faces[0].detectForVideo.mockReturnValue(NO_FACE);
    const tracker = await loadedTracker('hands-full', faces);

    tracker.process(video, 100, BOTH_PLAYERS);
    expect(tracker.process(video, 133, BOTH_PLAYERS).players[0].face).toBeUndefined();
  });

  it('reads a single asked-for face in every frame', async () => {
    const faces = loadAllModels();
    const tracker = await loadedTracker('hands-full', faces);

    for (const nowMs of [100, 133, 166]) tracker.process(video, nowMs, RIGHT_PLAYER_ONLY);

    expect(runTimes(faces[0])).toEqual([]);
    expect(runTimes(faces[1])).toEqual([100, 133, 166]);
  });

  it('never gives a face to a player it was not asked for', async () => {
    const faces = loadAllModels();
    const tracker = await loadedTracker('hands-full', faces);

    tracker.process(video, 100, BOTH_PLAYERS); // Reads player 0.
    const onlyRight = tracker.process(video, 133, RIGHT_PLAYER_ONLY);
    expect(onlyRight.players[0].face).toBeUndefined();
    expect(onlyRight.players[1].face).toBeDefined();
  });
});
