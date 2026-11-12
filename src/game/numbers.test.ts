import { describe, expect, it } from 'vitest';
import { clamp01 } from './numbers';

describe('clamp to 0..1', () => {
  it('keeps a value between 0 and 1 as it is', () => {
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(1)).toBe(1);
  });

  it('holds a value outside at the nearer end', () => {
    expect(clamp01(-0.2)).toBe(0);
    expect(clamp01(3)).toBe(1);
  });
});
