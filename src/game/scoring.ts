import type { Rating, Score } from './types';
export function freshScore(): Score { return { score: 0, combo: 0, maxCombo: 0, perfect: 0, good: 0, miss: 0, total: 0 }; }
export function award(score: Score, result: Rating): Score {
  const combo = result === 'miss' ? 0 : score.combo + 1;
  return { ...score, score: score.score + (result === 'perfect' ? 100 : result === 'good' ? 50 : 0) * (1 + Math.min(score.combo, 50) / 50),
    combo, maxCombo: Math.max(score.maxCombo, combo), [result]: score[result] + 1, total: score.total + 1 };
}
export function accuracy(s: Score): number { return s.total ? (s.perfect + 0.5 * s.good) / s.total : 0; }
export function stars(s: Score): number {
  const a = accuracy(s); return a >= 0.9 ? 5 : a >= 0.75 ? 4 : a >= 0.55 ? 3 : a >= 0.35 ? 2 : 1;
}
