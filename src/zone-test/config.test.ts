import { describe, expect, it } from 'vitest';
import { parseOptions } from './config';

describe('page options from the URL', () => {
  it('starts with three zones, at full length, with sound', () => {
    expect(parseOptions('')).toEqual({ zones: 3, quick: false, silent: false });
  });

  it.each([1, 2, 3, 4])('takes %i zones', (zones) => {
    expect(parseOptions(`?zones=${zones}`).zones).toBe(zones);
  });

  it.each(['0', '5', '2.5', 'many', ''])('keeps three zones for zones=%s', (zones) => {
    expect(parseOptions(`?zones=${zones}`).zones).toBe(3);
  });

  it('turns the sound off with silent=1', () => {
    expect(parseOptions('?silent=1')).toMatchObject({ quick: false, silent: true });
  });

  it('makes a quick run silent, whatever else the URL says', () => {
    expect(parseOptions('?quick=1')).toMatchObject({ quick: true, silent: true });
    expect(parseOptions('?quick=1&silent=0')).toMatchObject({ quick: true, silent: true });
  });
});
