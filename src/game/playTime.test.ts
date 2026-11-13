import { describe, expect, it } from 'vitest';
import { inCurrentStretch, pausePlay, playedSec, resumePlay, startPlay } from './playTime';

describe('the time a round has been played', () => {
  it('counts from the start of play', () => {
    expect(playedSec(startPlay(1000), 61_000)).toBe(60);
  });

  it('leaves the pauses out', () => {
    // 60 s of play with a 20 s pause in the middle.
    let time = startPlay(0);
    time = pausePlay(time, 30_000);
    time = resumePlay(time, 50_000);
    expect(playedSec(time, 80_000)).toBe(60);
  });

  it('stands still while paused', () => {
    const time = pausePlay(startPlay(0), 30_000);
    expect(playedSec(time, 45_000)).toBe(30);
    expect(playedSec(time, 90_000)).toBe(30);
  });

  it('ignores a second pause or a second resume', () => {
    let time = startPlay(0);
    time = pausePlay(pausePlay(time, 10_000), 20_000);
    time = resumePlay(resumePlay(time, 30_000), 40_000);
    expect(playedSec(time, 50_000)).toBe(30);
  });
});

describe('the current stretch of play', () => {
  it('holds the frames taken since the start of play', () => {
    const time = startPlay(1000);
    expect(inCurrentStretch(time, 1000)).toBe(true);
    expect(inCurrentStretch(time, 999)).toBe(false);
  });

  it('holds no frame taken before the last resume', () => {
    const time = resumePlay(pausePlay(startPlay(0), 5000), 5100);
    expect(inCurrentStretch(time, 4990)).toBe(false);
    expect(inCurrentStretch(time, 5100)).toBe(true);
  });

  it('holds no frame while paused', () => {
    expect(inCurrentStretch(pausePlay(startPlay(0), 5000), 4000)).toBe(false);
  });
});
