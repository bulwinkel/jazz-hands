import { describe, expect, it } from 'vitest';
import { canBeginCountdown } from './roundGates';
import type { Phase } from './types';

describe('the start of a countdown', () => {
  it('comes from the ready screen, the results and play', () => {
    for (const phase of ['ready', 'results', 'play'] as const) {
      expect(canBeginCountdown(phase, false)).toBe(true);
    }
  });

  it('comes from no other phase', () => {
    const others: Phase[] = ['menu', 'loading', 'fit', 'countdown', 'error'];
    for (const phase of others) {
      expect(canBeginCountdown(phase, false)).toBe(false);
    }
  });

  it('waits while a new tracker loads, so a restart after the M key does nothing', () => {
    for (const phase of ['ready', 'results', 'play'] as const) {
      expect(canBeginCountdown(phase, true)).toBe(false);
    }
  });
});
