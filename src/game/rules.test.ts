import { describe, expect, it } from 'vitest';
import type { TrackedFace, TrackedHand, TrackingFrame } from '../tracking/types';
import { synthetic } from './fixtures';
import { playEndSec, playStartSec, previewStartSec, validateManifest } from './manifest';
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
    ['a short-round start after the song', { shortStartSec: 500 }],
    ['a negative short-round start', { shortStartSec: -1 }],
  ])('rejects %s', (_name, patch) => {
    expect(() => validateManifest({ ...synthetic(), ...patch })).toThrow('Song manifest:');
  });

  it('ends the Short length on the first bar start at or after 90 seconds', () => {
    expect(playEndSec(synthetic(128), 'short')).toBe(90);
    expect(playEndSec(synthetic(100), 'short')).toBe(91.2);
    expect(playEndSec(synthetic(128), 'full')).toBe(120);
  });

  it('starts the Short length where the song says, and the Full length at the song start', () => {
    const song = { ...synthetic(120, 300), shortStartSec: 100 };
    expect(playStartSec(song, 'short')).toBe(100);
    expect(playStartSec(song, 'full')).toBe(0);
    expect(playStartSec(synthetic(), 'short')).toBe(0);
  });

  it('previews the liveliest part of a song, from a bar start', () => {
    // 120 BPM: a beat every 0.5 s and a bar every 2 s. The song is quiet but for 60 s to 90 s.
    const song = synthetic(120, 200, 0.2);
    song.intensity = song.beats.map((time) => (time >= 60 && time < 90 ? 0.9 : 0.2));
    // Every 20 s part that starts from 60 s to 70 s is all loud. The first of them wins.
    expect(previewStartSec(song)).toBe(60);
  });

  it('previews from a bar start, also when the loud part starts inside a bar', () => {
    const song = synthetic(120, 200, 0.2);
    song.intensity = song.beats.map((time) => (time >= 61 && time < 81 ? 0.9 : 0.2));
    // 60 s and 62 s are the bar starts around 61 s. Each part loses two loud beats: the first wins.
    expect(previewStartSec(song)).toBe(60);
  });

  it('previews a song of one loudness from its start', () => {
    expect(previewStartSec(synthetic())).toBe(0);
  });

  it('previews a song shorter than a preview from its start', () => {
    expect(previewStartSec(synthetic(120, 12))).toBe(0);
  });

  it('never previews past the end of the song', () => {
    // The loud part is the last 10 s. The last whole preview starts at 180 s.
    const song = synthetic(120, 200, 0.2);
    song.intensity = song.beats.map((time) => (time >= 190 ? 0.9 : 0.2));
    expect(previewStartSec(song)).toBe(180);
  });

  it('runs a late Short length for 90 seconds, to a bar start', () => {
    // 120 BPM: a bar is 2 s, so 190 s is a bar start.
    const song = { ...synthetic(120, 300), shortStartSec: 100 };
    expect(playEndSec(song, 'short')).toBe(190);
    expect(playEndSec(song, 'full')).toBe(300);
  });

  it('runs a Short length to the end of the song when under 90 seconds are left', () => {
    const song = { ...synthetic(120, 300), shortStartSec: 240 };
    expect(playEndSec(song, 'short')).toBe(300);
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
