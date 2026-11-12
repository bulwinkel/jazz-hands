import { describe, expect, it } from 'vitest';
import type { TrackedFace, TrackedHand, TrackingFrame } from '../tracking/types';
import { synthetic } from './fixtures';
import { playLengthSec, validateManifest } from './manifest';
import { accuracy, award, freshScore, stars } from './scoring';
import { mergeForSolo } from './solo';

describe('song manifest', () => {
  it('accepts a well-formed manifest', () => {
    const song = synthetic();
    expect(validateManifest(song)).toEqual(song);
  });

  it.each([
    ['beats out of order', { beats: [1, 0] }],
    ['intensity of another length', { intensity: [] }],
    ['a negative first downbeat', { firstDownbeat: -1 }],
    ['remote audio', { audio: 'https://example.com/a.mp3' }],
    ['protocol-relative audio', { audio: '//example.com/a' }],
    ['a tempo that is not a number', { bpm: NaN }],
    ['zero duration', { durationSec: 0 }],
    ['zero beats per bar', { beatsPerBar: 0 }],
  ])('rejects %s', (_name, patch) => {
    expect(() => validateManifest({ ...synthetic(), ...patch })).toThrow('Song manifest:');
  });

  it('ends the Short length on the first bar start at or after 90 seconds', () => {
    expect(playLengthSec(synthetic(128), 'short')).toBe(90);
    expect(playLengthSec(synthetic(100), 'short')).toBe(91.2);
    expect(playLengthSec(synthetic(128), 'full')).toBe(120);
  });
});

describe('scoring', () => {
  it('multiplies by the combo before the cue', () => {
    let score = award(freshScore(), 'perfect');
    expect(score).toMatchObject({ score: 100, combo: 1 });
    score = award(score, 'good');
    expect(score).toMatchObject({ score: 151, combo: 2, maxCombo: 2 });
  });

  it('resets the combo on a Miss and keeps the best combo', () => {
    let score = award(award(freshScore(), 'perfect'), 'good');
    score = award(score, 'miss');
    expect(score).toMatchObject({ combo: 0, maxCombo: 2, total: 3 });
    expect(accuracy(score)).toBe(0.5);
  });

  it('caps the multiplier at 2x from a combo of 50', () => {
    const hot = { ...freshScore(), combo: 60 };
    expect(award(hot, 'perfect').score).toBe(200);
  });

  it.each([
    [0, 1],
    [35, 2],
    [55, 3],
    [75, 4],
    [90, 5],
  ])('gives %i%% accuracy %i stars', (perfect, expected) => {
    expect(stars({ ...freshScore(), perfect, total: 100 })).toBe(expected);
  });
});

describe('one-player hand merge', () => {
  const hand = (x: number, size: number): TrackedHand => ({ x, y: 0.5, size, gesture: 'open', gestureScore: 1 });
  const frame = (left: TrackedHand[], right: TrackedHand[]): TrackingFrame => ({
    timeMs: 5,
    inferenceMs: 1,
    players: [{ hands: left }, { hands: right }],
  });

  it('gives player 0 the hands from both halves of the frame', () => {
    const merged = mergeForSolo(frame([hand(0.3, 0.1)], [hand(0.7, 0.1)]));
    expect(merged.players[0].hands.map((h) => h.x)).toEqual([0.3, 0.7]);
    expect(merged.players[1].hands).toEqual([]);
    expect(merged.timeMs).toBe(5);
  });

  it('keeps the two largest hands', () => {
    const merged = mergeForSolo(frame([hand(0.1, 0.05), hand(0.2, 0.2)], [hand(0.8, 0.15), hand(0.9, 0.01)]));
    expect(merged.players[0].hands.map((h) => h.size)).toEqual([0.2, 0.15]);
  });
});

describe('one-player face merge', () => {
  const face: TrackedFace = { x: 0.6, y: 0.3, expressions: { smile: 0.9, openMouth: 0, pucker: 0 } };
  const frame = (left?: TrackedFace, right?: TrackedFace): TrackingFrame => ({
    timeMs: 5,
    inferenceMs: 1,
    players: [
      { hands: [], face: left },
      { hands: [], face: right },
    ],
  });

  it('gives player 0 the face, whichever player it was found for', () => {
    expect(mergeForSolo(frame(face)).players[0].face).toBe(face);
    expect(mergeForSolo(frame(undefined, face)).players[0].face).toBe(face);
    expect(mergeForSolo(frame(undefined, face)).players[1].face).toBeUndefined();
  });

  it('adds no face when none was found', () => {
    expect('face' in mergeForSolo(frame()).players[0]).toBe(false);
  });
});
