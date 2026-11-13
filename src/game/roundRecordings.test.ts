import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECORDING } from './config';
import type { RecordedVideo, RoundVideos } from './recording';
import { recordingTailSec, RoundRecordings, tailShare } from './roundRecordings';
import type { RecordingSource } from './roundRecordings';

describe('recording tail', () => {
  it('lasts the usual time after the results while the sound delays are short', () => {
    expect(recordingTailSec({ game: 0.04, camera: 0.14 })).toBe(RECORDING.tailSec);
  });

  it('lasts until the end of the song has reached the video with the longest delay', () => {
    expect(recordingTailSec({ game: 2.3, camera: 4.3 })).toBeCloseTo(4.3 + RECORDING.soundTailMarginSec);
    expect(recordingTailSec({ game: 5, camera: 0 })).toBeCloseTo(5 + RECORDING.soundTailMarginSec);
  });

  it('changes from the usual time to the delay at the point where the delay and margin reach it', () => {
    const boundary = RECORDING.tailSec - RECORDING.soundTailMarginSec;
    expect(recordingTailSec({ game: 0, camera: boundary })).toBe(RECORDING.tailSec);
    expect(recordingTailSec({ game: 0, camera: boundary + 0.1 })).toBeGreaterThan(RECORDING.tailSec);
  });

  it('has passed by the share of its time that has gone, from 0 to 1', () => {
    expect(tailShare(0, 4)).toBe(0);
    expect(tailShare(1, 4)).toBe(0.25);
    expect(tailShare(4, 4)).toBe(1);
    expect(tailShare(5, 4)).toBe(1);
    expect(tailShare(-0.1, 4)).toBe(0);
  });

  it('has passed at once when it has no length', () => {
    expect(tailShare(0, 0)).toBe(1);
  });
});

/** A stand-in recorder. The test finishes its stop by hand. */
function fakeRecorder(failStart = false) {
  let finishStop: (videos: RecordedVideo[]) => void = () => {};
  const recorder = {
    active: false,
    start: vi.fn(() => {
      // The real recorder can fail on its second video, after the first has started.
      if (failStart) throw new Error('NotSupportedError');
      recorder.active = true;
    }),
    drawFrame: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(() => {
      recorder.active = false;
      return new Promise<RecordedVideo[]>((resolve) => (finishStop = resolve));
    }),
    discard: vi.fn(() => {
      recorder.active = false;
    }),
  };
  return { recorder, finishStop: () => finishStop([{ kind: 'game', blob: new Blob(['video']), extension: 'mp4' }]) };
}

const source: RecordingSource = {
  sound: { game: {} as MediaStream, camera: {} as MediaStream },
  songId: 'song',
};

/** Lets every finished promise run its next step. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('round recordings', () => {
  let recorders: ReturnType<typeof fakeRecorder>[];
  let recordings: RoundRecordings;
  let revoked: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    // The recordings set their timers on the window, as in the browser.
    vi.stubGlobal('window', globalThis);
    let urls = 0;
    revoked = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:video-${++urls}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => void revoked.push(url));
    recorders = [];
    recordings = new RoundRecordings(vi.fn(), () => {
      const fake = fakeRecorder();
      recorders.push(fake);
      return fake.recorder;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Records a round to its results, and waits until its videos are ready. */
  async function recordRound(): Promise<RoundVideos> {
    recordings.begin(source);
    recordings.endAfter(4, 0);
    vi.advanceTimersByTime(4000);
    recorders[recorders.length - 1].finishStop();
    await settle();
    const view = recordings.view(5000);
    if (view.stage !== 'ready') throw new Error(`The videos are not ready: ${view.stage}`);
    return view.videos;
  }

  it('discards a recording whose start fails half-way, and lets the round run without one', () => {
    const failing = fakeRecorder(true);
    const withFailingStart = new RoundRecordings(vi.fn(), () => failing.recorder);
    withFailingStart.begin(source);
    expect(failing.recorder.discard).toHaveBeenCalledTimes(1);
    expect(withFailingStart.active).toBe(false);
    expect(withFailingStart.view(0)).toEqual({ stage: 'none' });
  });

  it('shows nothing while recording is off', () => {
    recordings.begin();
    recordings.endAfter(4, 0);
    expect(recordings.view(1000)).toEqual({ stage: 'none' });
  });

  it('goes from the last seconds to the finishing of the videos, then to the videos', async () => {
    recordings.begin(source);
    recordings.endAfter(4, 10_000);
    expect(recordings.view(11_500)).toEqual({ stage: 'tail', tailSec: 4, passedSec: 1.5 });
    expect(recordings.active).toBe(true);
    vi.advanceTimersByTime(4000);
    expect(recordings.view(14_000)).toEqual({ stage: 'finishing' });
    expect(recordings.active).toBe(false);
    recorders[0].finishStop();
    await settle();
    const view = recordings.view(15_000);
    expect(view.stage).toBe('ready');
    expect(view.stage === 'ready' && view.videos.videos.map((video) => video.url)).toEqual(['blob:video-1']);
  });

  it('cancels the stop timer of a recording when the results close before it', () => {
    recordings.begin(source);
    recordings.endAfter(4, 0);
    recordings.drop();
    recordings.begin(source);
    vi.advanceTimersByTime(10_000);
    // The old timer must not end the recording of the newer round.
    expect(recorders[1].recorder.stop).not.toHaveBeenCalled();
    expect(recordings.active).toBe(true);
  });

  it('lets a new stop timer replace the old one', () => {
    recordings.begin(source);
    recordings.endAfter(4, 0);
    recordings.endAfter(6, 0);
    vi.advanceTimersByTime(4000);
    expect(recorders[0].recorder.stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(recorders[0].recorder.stop).toHaveBeenCalledTimes(1);
  });

  it('frees the videos when the results close', async () => {
    const round = await recordRound();
    expect(revoked).toEqual([]);
    recordings.drop();
    expect(revoked).toEqual(round.videos.map((video) => video.url));
    expect(recordings.view(6000)).toEqual({ stage: 'none' });
  });

  it('throws away a recording in its last seconds when the results close: its videos never appear', async () => {
    recordings.begin(source);
    recordings.endAfter(4, 0);
    recordings.drop();
    expect(recorders[0].recorder.discard).toHaveBeenCalledTimes(1);
    expect(recordings.active).toBe(false);
    vi.advanceTimersByTime(10_000);
    await settle();
    expect(recorders[0].recorder.stop).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(recordings.view(10_000)).toEqual({ stage: 'none' });
  });

  it('drops the videos of a recording still being finished as soon as they arrive, when the results closed', async () => {
    recordings.begin(source);
    recordings.endAfter(4, 0);
    vi.advanceTimersByTime(4000);
    expect(recordings.view(4000)).toEqual({ stage: 'finishing' });
    recordings.drop();
    expect(recordings.view(4000)).toEqual({ stage: 'none' });
    recorders[0].finishStop();
    await settle();
    // No page link was made for them, so nothing keeps them.
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(recordings.view(5000)).toEqual({ stage: 'none' });
  });

  it('starts a new round with no videos, and frees those of the round before', async () => {
    const round = await recordRound();
    recordings.begin(source);
    expect(recordings.view(6000)).toEqual({ stage: 'none' });
    expect(revoked).toEqual(round.videos.map((video) => video.url));
  });

  it('never shows the videos of a round that finish after a new round began', async () => {
    recordings.begin(source);
    recordings.endAfter(4, 0);
    vi.advanceTimersByTime(4000);
    recordings.begin(source);
    recorders[0].finishStop();
    await settle();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(recordings.active).toBe(true);
  });

  it('frees the videos when the page goes away', async () => {
    const round = await recordRound();
    recordings.dispose();
    expect(revoked).toEqual(round.videos.map((video) => video.url));
  });
});
