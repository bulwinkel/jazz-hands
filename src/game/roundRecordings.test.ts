import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECORDING } from './config';
import type { RecordedVideo, RoundVideos } from './recording';
import { addRound, recordingStatus, recordingTailSec, RoundRecordings } from './roundRecordings';
import type { RecordingSource } from './roundRecordings';

describe('list of recorded rounds', () => {
  it('puts a new round first', () => {
    expect(addRound(['b', 'c'], 'a', 3).kept).toEqual(['a', 'b', 'c']);
  });

  it('drops nothing while there is room', () => {
    expect(addRound(['b'], 'a', 3).dropped).toEqual([]);
  });

  it('keeps the newest rounds and hands back the ones it dropped', () => {
    expect(addRound(['b', 'c', 'd'], 'a', 3)).toEqual({ kept: ['a', 'b', 'c'], dropped: ['d'] });
    expect(addRound(['b', 'c', 'd', 'e'], 'a', 2)).toEqual({ kept: ['a', 'b'], dropped: ['c', 'd', 'e'] });
  });

  it('leaves the list it was given as it was', () => {
    const rounds = ['b', 'c', 'd'];
    addRound(rounds, 'a', 3);
    expect(rounds).toEqual(['b', 'c', 'd']);
  });
});

describe('recording status', () => {
  it('says that the last seconds are recorded while a recording runs', () => {
    expect(recordingStatus(true, 0)).toBe('Recording the last seconds…');
    expect(recordingStatus(true, 1)).toBe('Recording the last seconds…');
  });

  it('says that a video is finishing after its recording ended', () => {
    expect(recordingStatus(false, 1)).toBe('Finishing the video…');
  });

  it('says nothing when no recording is on its way', () => {
    expect(recordingStatus(false, 0)).toBe('');
  });
});

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
  song: { id: 'song', title: 'Song' },
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

  /** Records a whole round and waits until its videos are in the list. */
  async function recordRound(): Promise<RoundVideos> {
    recordings.begin(source);
    recordings.end(true);
    recorders[recorders.length - 1].finishStop();
    await settle();
    return recordings.view.rounds[0];
  }

  it('discards a recording whose start fails half-way, and lets the round run without one', () => {
    const failing = fakeRecorder(true);
    const withFailingStart = new RoundRecordings(vi.fn(), () => failing.recorder);
    withFailingStart.begin(source);
    expect(failing.recorder.discard).toHaveBeenCalledTimes(1);
    expect(withFailingStart.active).toBe(false);
  });

  it('cancels the stop timer of a recording when it ends before the timer', () => {
    recordings.begin(source);
    recordings.endAfter(4);
    recordings.end(true);
    recordings.begin(source);
    vi.advanceTimersByTime(10_000);
    // The old timer must not end the recording of the newer round.
    expect(recorders[1].recorder.stop).not.toHaveBeenCalled();
    expect(recordings.active).toBe(true);
  });

  it('lets a new stop timer replace the old one', () => {
    recordings.begin(source);
    recordings.endAfter(4);
    recordings.endAfter(6);
    vi.advanceTimersByTime(4000);
    expect(recorders[0].recorder.stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(recorders[0].recorder.stop).toHaveBeenCalledTimes(1);
  });

  it('keeps a round that left the list alive while the player shows it, and frees it after', async () => {
    const oldest = await recordRound();
    await recordRound();
    await recordRound();
    recordings.playerShows(oldest);
    await recordRound();
    expect(recordings.view.rounds).not.toContain(oldest);
    expect(revoked).toEqual([]);
    recordings.playerShows(undefined);
    expect(revoked).toEqual(oldest.videos.map((video) => video.url));
  });

  it('frees a round that leaves the list at once when the player does not show it', async () => {
    const oldest = await recordRound();
    await recordRound();
    await recordRound();
    await recordRound();
    expect(revoked).toEqual(oldest.videos.map((video) => video.url));
  });

  it('offers the videos of the last round as its preview', async () => {
    const round = await recordRound();
    expect(recordings.view.lastRound).toBe(round);
  });

  it('offers no preview from a round when a newer round began while its videos were made', async () => {
    recordings.begin(source);
    recordings.end(true);
    recordings.begin(source);
    recorders[0].finishStop();
    await settle();
    expect(recordings.view.rounds).toHaveLength(1);
    expect(recordings.view.lastRound).toBeUndefined();
  });
});
