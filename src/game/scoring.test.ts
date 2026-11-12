import { expect, it } from 'vitest';
import { accuracy, award, freshScore, stars } from './scoring';
it('scores with the previous combo, caps the multiplier and resets misses', () => {
  let s = award(freshScore(), 'perfect'); expect(s.score).toBe(100); expect(s.combo).toBe(1);
  s = award(s, 'good'); expect(s.score).toBe(151); expect(s.maxCombo).toBe(2);
  s = award(s, 'miss'); expect(s.combo).toBe(0); expect(s.maxCombo).toBe(2); expect(s.total).toBe(3); expect(accuracy(s)).toBe(0.5);
  s.combo = 60; const next = award(s, 'perfect'); expect(next.score - s.score).toBe(200);
});
it('maps all star thresholds', () => { for (const [perfect, expected] of [[0, 1], [35, 2], [55, 3], [75, 4], [90, 5]]) expect(stars({ ...freshScore(), perfect, total: 100 })).toBe(expected); });
