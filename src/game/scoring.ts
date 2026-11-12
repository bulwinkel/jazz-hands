import type { Rating, Score } from './types';

const POINTS: Record<Rating, number> = { perfect: 100, good: 50, miss: 0 };
/** The multiplier grows from 1x at combo 0 to 2x at this combo, then stays. */
const COMBO_CAP = 50;
/** Lowest accuracy for 2, 3, 4 and 5 stars. */
const STAR_THRESHOLDS = [0.35, 0.55, 0.75, 0.9];

export function freshScore(): Score {
  return { score: 0, combo: 0, maxCombo: 0, perfect: 0, good: 0, miss: 0, total: 0 };
}

/** Adds one judged cue. The combo before this cue sets its multiplier. */
export function award(score: Score, result: Rating): Score {
  const multiplier = 1 + Math.min(score.combo, COMBO_CAP) / COMBO_CAP;
  const combo = result === 'miss' ? 0 : score.combo + 1;
  return {
    ...score,
    score: score.score + POINTS[result] * multiplier,
    combo,
    maxCombo: Math.max(score.maxCombo, combo),
    [result]: score[result] + 1,
    total: score.total + 1,
  };
}

/** A Good counts as half a Perfect. */
export function accuracy(score: Score): number {
  return score.total ? (score.perfect + 0.5 * score.good) / score.total : 0;
}

export function stars(score: Score): number {
  const value = accuracy(score);
  return 1 + STAR_THRESHOLDS.filter((threshold) => value >= threshold).length;
}
