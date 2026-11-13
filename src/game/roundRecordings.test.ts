import { describe, expect, it } from 'vitest';
import { RECORDING } from './recording';
import { addRound, recordingStatus, recordingTailSec } from './roundRecordings';

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
