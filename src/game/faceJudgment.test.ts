import { describe, expect, it } from 'vitest';
import type { FaceExpression, TrackedFace } from '../tracking/types';
import { FACES, LEVELS } from './config';
import { judgeFaceFrame, needsFace, newFaceCueState, openFaceCue } from './faceJudgment';
import type { FaceCueState } from './faceJudgment';
import type { FaceCue, Level, Rating } from './types';

const ALL_LEVELS: Level[] = [1, 2, 3, 4];
const ALL_EXPRESSIONS: FaceExpression[] = ['smile', 'openMouth', 'pucker'];

function face(expression: FaceExpression, strength = 1): TrackedFace {
  return { x: 0.25, y: 0.3, expressions: { smile: 0, openMouth: 0, pucker: 0, [expression]: strength } };
}

/** A face cue due at 1 s. */
function cue(expression: FaceExpression = 'smile', timeSec = 1): FaceCue {
  return { timeSec, beatIndex: 2, expression };
}

/** Feeds one frame into `state`. Returns the rating only on the frame that makes the cue final. */
function step(
  state: FaceCueState,
  level: Level,
  tracked: TrackedFace | undefined,
  timeSec: number,
): Rating | undefined {
  const wasFinal = state.result !== undefined;
  Object.assign(state, judgeFaceFrame(state, level, tracked, timeSec));
  return wasFinal ? undefined : state.result;
}

const at = (dueSec: number, offsetMs: number): number => dueSec + offsetMs / 1000;

describe('judgeFaceFrame', () => {
  it('returns a new state and leaves the old one alone', () => {
    const before = newFaceCueState(cue());
    const after = judgeFaceFrame(before, 2, face('smile'), 1);
    expect(before.mark).toBeNull();
    expect(before.result).toBeUndefined();
    expect(after.result).toBe('perfect');
  });

  it('never changes a final cue', () => {
    const state = newFaceCueState(cue());
    step(state, 2, undefined, 2);
    expect(state.result).toBe('miss');
    expect(step(state, 2, face('smile'), 2)).toBeUndefined();
    expect(state.result).toBe('miss');
  });
});

describe.each(ALL_LEVELS)('timing windows at level %i', (level) => {
  const { perfectMs, goodMs } = LEVELS[level];
  const afterClose = at(1, goodMs[1] + 1);

  it('scores Perfect at both edges of the Perfect window', () => {
    for (const edge of perfectMs) {
      expect(step(newFaceCueState(cue()), level, face('smile'), at(1, edge))).toBe('perfect');
    }
  });

  it('scores Good just outside the Perfect window, once the Good window closes', () => {
    for (const offset of [perfectMs[0] - 1, perfectMs[1] + 1]) {
      const state = newFaceCueState(cue());
      expect(step(state, level, face('smile'), at(1, offset))).toBeUndefined();
      expect(step(state, level, undefined, afterClose)).toBe('good');
    }
  });

  it('scores Good at both edges of the Good window', () => {
    for (const edge of goodMs) {
      const state = newFaceCueState(cue());
      expect(step(state, level, face('smile'), at(1, edge))).toBeUndefined();
      expect(step(state, level, undefined, afterClose)).toBe('good');
    }
  });

  it('scores Miss for a face that is only pulled outside the Good window', () => {
    const state = newFaceCueState(cue());
    step(state, level, face('smile'), at(1, goodMs[0] - 1));
    expect(step(state, level, face('smile'), afterClose)).toBe('miss');
  });

  it('scores Perfect for pulling the face early and holding it, as soon as the Perfect window opens', () => {
    const state = newFaceCueState(cue());
    expect(step(state, level, face('smile'), at(1, goodMs[0] + 10))).toBeUndefined();
    expect(state.mark).toBe('good');
    expect(step(state, level, face('smile'), at(1, perfectMs[0]))).toBe('perfect');
  });

  it('keeps a Good mark when the face relaxes before the Perfect window', () => {
    const state = newFaceCueState(cue());
    step(state, level, face('smile'), at(1, goodMs[0] + 10));
    step(state, level, face('smile', 0), at(1, 0));
    expect(step(state, level, undefined, afterClose)).toBe('good');
  });
});

describe('the expression', () => {
  const afterClose = at(1, LEVELS[2].goodMs[1] + 1);

  it.each(ALL_EXPRESSIONS)('%s counts from its threshold', (expression) => {
    const threshold = FACES.thresholds[expression];
    expect(step(newFaceCueState(cue(expression)), 2, face(expression, threshold), 1)).toBe('perfect');
  });

  it.each(ALL_EXPRESSIONS)('%s below its threshold is a Miss', (expression) => {
    const state = newFaceCueState(cue(expression));
    const tooWeak = face(expression, FACES.thresholds[expression] - 0.01);
    expect(step(state, 2, tooWeak, 1)).toBeUndefined();
    expect(step(state, 2, tooWeak, afterClose)).toBe('miss');
  });

  it('must be the one the cue asks for', () => {
    const state = newFaceCueState(cue('smile'));
    expect(step(state, 2, face('openMouth'), 1)).toBeUndefined();
    expect(step(state, 2, face('pucker'), afterClose)).toBe('miss');
  });

  it('is a Miss when no face is found', () => {
    const state = newFaceCueState(cue());
    expect(step(state, 2, undefined, 1)).toBeUndefined();
    expect(step(state, 2, undefined, afterClose)).toBe('miss');
  });
});

describe('the open face cue', () => {
  const level: Level = 2;
  const { approachSec } = LEVELS[level];

  it('is the first cue that is on screen and not final', () => {
    const states = [newFaceCueState(cue('smile', 10)), newFaceCueState(cue('pucker', 20))];
    expect(openFaceCue(states, level, 10 - approachSec - 0.01)).toBeUndefined();
    expect(openFaceCue(states, level, 10 - approachSec)).toBe(states[0]);
    expect(openFaceCue(states, level, 10.2)).toBe(states[0]);

    states[0] = judgeFaceFrame(states[0], level, face('smile'), 10);
    expect(states[0].result).toBe('perfect');
    expect(openFaceCue(states, level, 10.2)).toBeUndefined();
    expect(openFaceCue(states, level, 20 - approachSec)).toBe(states[1]);
  });

  it('stays open through its judging window, until the cue is final', () => {
    const states = [newFaceCueState(cue('smile', 10))];
    const closeSec = at(10, LEVELS[level].goodMs[1] + 1);
    expect(openFaceCue(states, level, closeSec)).toBe(states[0]);
    states[0] = judgeFaceFrame(states[0], level, undefined, closeSec);
    expect(openFaceCue(states, level, closeSec)).toBeUndefined();
  });

  it('is nothing for a player with no face cues', () => {
    expect(openFaceCue([], level, 10)).toBeUndefined();
  });
});

describe('when the game needs a face from the tracker', () => {
  const level: Level = 2;
  const { approachSec, goodMs } = LEVELS[level];
  const INPUT_LATENCY_SEC = 0.1;
  const cues = [cue('smile', 10), cue('pucker', 20)];
  const needsFaceAt = (songTimeSec: number): boolean => needsFace(cues, level, songTimeSec, INPUT_LATENCY_SEC);

  it('starts when a face cue comes on screen', () => {
    expect(needsFaceAt(10 - approachSec - 0.01)).toBe(false);
    expect(needsFaceAt(10 - approachSec)).toBe(true);
  });

  it('lasts to the end of the Good window, for a frame that is judged later by the input delay', () => {
    const windowEndSec = at(10, goodMs[1]);
    expect(needsFaceAt(windowEndSec)).toBe(true);
    expect(needsFaceAt(windowEndSec + INPUT_LATENCY_SEC - 0.001)).toBe(true);
    expect(needsFaceAt(windowEndSec + INPUT_LATENCY_SEC + 0.001)).toBe(false);
  });

  it('does not stop at a hit: the cue has no say in it', () => {
    // The run report needs the whole window, also after the cue is final.
    expect(needsFaceAt(10.2)).toBe(true);
  });

  it('is off between two cues, and for a player with no face cues', () => {
    expect(needsFaceAt(15)).toBe(false);
    expect(needsFaceAt(20)).toBe(true);
    expect(needsFace([], level, 10, INPUT_LATENCY_SEC)).toBe(false);
  });
});
