import { describe, expect, it } from 'vitest';
import type { GestureName, TrackedHand } from '../tracking/types';
import { LEVELS } from './config';
import { cellCentre, defaultGrid } from './geometry';
import { closingSongTime, frameSongTime, judgeFrame, newCueState } from './judgment';
import type { CueState } from './judgment';
import type { Cue, Level, Rating } from './types';

const grid = defaultGrid(0, 2);
const ALL_LEVELS: Level[] = [1, 2, 3, 4, 5];

function hand(cell: number, gesture: GestureName = 'open'): TrackedHand {
  return { ...cellCentre(grid, cell), gesture, size: 0.05, gestureScore: 1 };
}

/** A tap due at 1 s. */
function tap(cells: number[], gesture?: GestureName): Cue {
  return { kind: 'tap', timeSec: 1, beatIndex: 2, cells, times: cells.map(() => 1), gesture };
}

/** A slide from cell 0, due at 1 s, to cell 2, due at 1.6 s. */
function slide(): Cue {
  return { kind: 'slide', timeSec: 1, beatIndex: 2, cells: [0, 2], times: [1, 1.6] };
}

/** Feeds one frame into `state`. Returns the rating only on the frame that makes the cue final. */
function step(state: CueState, level: Level, hands: TrackedHand[], timeSec: number): Rating | undefined {
  const wasFinal = state.result !== undefined;
  Object.assign(state, judgeFrame(state, level, grid, hands, timeSec));
  return wasFinal ? undefined : state.result;
}

const at = (dueSec: number, offsetMs: number): number => dueSec + offsetMs / 1000;

describe('judgeFrame', () => {
  it('returns a new state and leaves the old one alone', () => {
    const before = newCueState(tap([4]));
    const after = judgeFrame(before, 2, grid, [hand(4)], 1);
    expect(before.marks).toEqual([null]);
    expect(before.result).toBeUndefined();
    expect(after.result).toBe('perfect');
  });

  it('never changes a final cue', () => {
    const state = newCueState(tap([4]));
    step(state, 2, [], 2);
    expect(state.result).toBe('miss');
    expect(step(state, 2, [hand(4)], 2)).toBeUndefined();
    expect(state.result).toBe('miss');
  });
});

describe.each(ALL_LEVELS)('timing windows at level %i', (level) => {
  const { perfectMs, goodMs } = LEVELS[level];
  const afterClose = at(1, goodMs[1] + 1);

  it('scores Perfect at both edges of the Perfect window', () => {
    for (const edge of perfectMs) {
      expect(step(newCueState(tap([4])), level, [hand(4)], at(1, edge))).toBe('perfect');
    }
  });

  it('scores Good just outside the Perfect window, once the Good window closes', () => {
    for (const offset of [perfectMs[0] - 1, perfectMs[1] + 1]) {
      const state = newCueState(tap([4]));
      expect(step(state, level, [hand(4)], at(1, offset))).toBeUndefined();
      expect(step(state, level, [], afterClose)).toBe('good');
    }
  });

  it('scores Good at both edges of the Good window', () => {
    for (const edge of goodMs) {
      const state = newCueState(tap([4]));
      expect(step(state, level, [hand(4)], at(1, edge))).toBeUndefined();
      expect(step(state, level, [], afterClose)).toBe('good');
    }
  });

  it('scores Miss for a hand that is only there outside the Good window', () => {
    const state = newCueState(tap([4]));
    step(state, level, [hand(4)], at(1, goodMs[0] - 1));
    expect(step(state, level, [hand(4)], afterClose)).toBe('miss');
  });

  it('scores Perfect for arriving early and holding, as soon as the Perfect window opens', () => {
    const state = newCueState(tap([4]));
    expect(step(state, level, [hand(4)], at(1, goodMs[0] + 10))).toBeUndefined();
    expect(step(state, level, [hand(4)], at(1, perfectMs[0]))).toBe('perfect');
  });
});

describe('two hands at once', () => {
  it('takes the worse of the two cells', () => {
    const state = newCueState(tap([0, 2]));
    step(state, 2, [hand(0)], 1);
    step(state, 2, [hand(2)], 1.3);
    expect(step(state, 2, [], 1.4)).toBe('good');
  });

  it('is a Miss when one cell is never hit', () => {
    const state = newCueState(tap([0, 2]));
    step(state, 2, [hand(0)], 1);
    expect(step(state, 2, [], 1.4)).toBe('miss');
  });

  it('is Perfect when both hands are in place on the beat', () => {
    expect(step(newCueState(tap([0, 2])), 2, [hand(0), hand(2)], 1)).toBe('perfect');
  });
});

describe('hand shapes', () => {
  it('needs the asked-for shape', () => {
    const state = newCueState(tap([4], 'fist'));
    step(state, 2, [hand(4, 'open')], 1);
    expect(step(state, 2, [], 2)).toBe('miss');
    expect(step(newCueState(tap([4], 'fist')), 2, [hand(4, 'fist')], 1)).toBe('perfect');
  });

  it('needs the shape from both hands of a double', () => {
    const bothFists = newCueState(tap([0, 2], 'fist'));
    expect(step(bothFists, 5, [hand(0, 'fist'), hand(2, 'fist')], 1)).toBe('perfect');

    const oneOpen = newCueState(tap([0, 2], 'fist'));
    step(oneOpen, 5, [hand(0, 'fist'), hand(2, 'open')], 1);
    expect(step(oneOpen, 5, [], 2)).toBe('miss');
  });

  it('needs the shape at every cell of a slide', () => {
    const shaped: Cue = { ...slide(), gesture: 'peace' };
    const held = newCueState(shaped);
    step(held, 5, [hand(0, 'peace')], 1);
    expect(step(held, 5, [hand(2, 'peace')], 1.6)).toBe('perfect');

    const dropped = newCueState(shaped);
    step(dropped, 5, [hand(0, 'peace')], 1);
    step(dropped, 5, [hand(2, 'open')], 1.6);
    expect(step(dropped, 5, [], 3)).toBe('miss');
  });

  it('judges position only when the tracker cannot read shapes', () => {
    expect(step(newCueState(tap([4], 'fist')), 2, [hand(4, 'unknown')], 1)).toBe('perfect');
  });
});

describe('slides', () => {
  const closeSec = at(1.6, LEVELS[3].goodMs[1] + 1);

  it('is Perfect when the hand is at each end on its beat', () => {
    const state = newCueState(slide());
    expect(step(state, 3, [hand(0)], 1)).toBeUndefined();
    expect(state.marks).toEqual(['perfect', null]);
    expect(step(state, 3, [hand(2)], 1.6)).toBe('perfect');
  });

  it('is Good when the start is on time and the end is late', () => {
    const state = newCueState(slide());
    step(state, 3, [hand(0)], 1);
    step(state, 3, [hand(2)], at(1.6, LEVELS[3].perfectMs[1] + 50));
    expect(step(state, 3, [], closeSec)).toBe('good');
  });

  it('is a Miss when the start is skipped, and stays open until the end window closes', () => {
    const state = newCueState(slide());
    // Past the start cell's window, but the slide is not final until its end cell is judged.
    expect(step(state, 3, [], at(1, LEVELS[3].goodMs[1] + 1))).toBeUndefined();
    expect(step(state, 3, [hand(2)], 1.6)).toBeUndefined();
    expect(step(state, 3, [], closeSec)).toBe('miss');
  });

  it('is a Miss when the hand never reaches the end', () => {
    const state = newCueState(slide());
    step(state, 3, [hand(0)], 1);
    expect(step(state, 3, [hand(0)], closeSec)).toBe('miss');
  });

  it('needs the middle cell of a slow slide on its own beat', () => {
    const slow: Cue = { kind: 'slide', speed: 'slow', timeSec: 1, beatIndex: 2, cells: [0, 1, 2], times: [1, 1.6, 2.2] };
    const afterEnd = at(2.2, LEVELS[3].goodMs[1] + 1);

    const followed = newCueState(slow);
    step(followed, 3, [hand(0)], 1);
    step(followed, 3, [hand(1)], 1.6);
    expect(step(followed, 3, [hand(2)], 2.2)).toBe('perfect');

    const jumped = newCueState(slow);
    step(jumped, 3, [hand(0)], 1);
    step(jumped, 3, [hand(2)], 2.2);
    expect(step(jumped, 3, [], afterEnd)).toBe('miss');
  });

  it('does not count the end cell before its own window opens', () => {
    const state = newCueState(slide());
    step(state, 3, [hand(0), hand(2)], 1);
    expect(state.marks).toEqual(['perfect', null]);
  });
});

describe('frameSongTime', () => {
  it('takes the frame age and the input delay off the song time', () => {
    expect(frameSongTime(10, 1200, 1000, 100)).toBeCloseTo(9.7);
  });
});

describe('closingSongTime', () => {
  const NO_LIMIT = Number.POSITIVE_INFINITY;

  it('closes windows at the song time of now, less the input delay, with no frame to wait for', () => {
    expect(closingSongTime(10, 2000, 100, undefined, NO_LIMIT)).toBeCloseTo(9.899);
  });

  it('keeps windows open for a frame still in a worker, up to its song time', () => {
    // The frame was taken 60 ms ago: it shows the song 60 ms back.
    expect(closingSongTime(10, 2000, 100, 1940, NO_LIMIT)).toBeCloseTo(9.839);
  });

  it('waits for no frame older than the limit', () => {
    expect(closingSongTime(10, 2000, 100, 1940, 50)).toBeCloseTo(9.899);
  });

  it('never closes later than now for a frame that came in the future of the song clock', () => {
    expect(closingSongTime(10, 2000, 100, 2010, NO_LIMIT)).toBeCloseTo(9.899);
  });
});
