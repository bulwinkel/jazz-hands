import { describe, expect, it } from 'vitest';
import { addRound } from './roundRecordings';

describe('list of recorded rounds', () => {
  it('puts a new round first', () => {
    expect(addRound(['b', 'c'], 'a', 3).kept).toEqual(['a', 'b', 'c']);
  });

  it('drops nothing while there is room', () => {
    expect(addRound(['b'], 'a', 3).dropped).toEqual([]);
  });

  it('keeps the newest rounds and hands back the ones it dropped', () => {
    expect(addRound(['b', 'c', 'd'], 'a', 3)).toEqual({ kept: ['a', 'b', 'c'], dropped: ['d'] });
    expect(addRound(['b', 'c', 'd', 'e'], 'a', 2)).toEqual({ kept: ['a', 'b'], dropped: ['c', 'd', 'e'] });
  });

  it('leaves the list it was given as it was', () => {
    const rounds = ['b', 'c', 'd'];
    addRound(rounds, 'a', 3);
    expect(rounds).toEqual(['b', 'c', 'd']);
  });
});
