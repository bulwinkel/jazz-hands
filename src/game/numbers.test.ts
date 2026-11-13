import { describe, expect, it } from 'vitest';
import { clamp, clamp01, median } from './numbers';

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

describe('clamp', () => {
  it('keeps a value inside the range as it is', () => {
    expect(clamp(30, 22, 42)).toBe(30);
  });

  it('holds a value outside the range at the nearer end', () => {
    expect(clamp(10, 22, 42)).toBe(22);
    expect(clamp(50, 22, 42)).toBe(42);
    expect(clamp(-3, -1, 2)).toBe(-1);
  });
});

describe('median', () => {
  it('is the middle value of an odd count, in any order', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([0.4])).toBe(0.4);
  });

  it('is the mean of the two middle values of an even count', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('is 0 when there are no values', () => {
    expect(median([])).toBe(0);
  });

  it('leaves the values it was given in their order', () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});
