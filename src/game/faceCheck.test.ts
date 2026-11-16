import { describe, expect, it } from 'vitest';
import { botPlayer } from './bot';
import { FACES, TIMING } from './config';
import { countFaceSighting, decideFaceCues, facesOffText, looksForFaceBeforePlay, restartFaceCheck } from './faceCheck';
import type { FaceCheckedPlayer, FaceCheckMoment } from './faceCheck';
import { defaultGrid } from './geometry';
import { createPlayers } from './player';
import { parseSettings } from './settings';
import type { FaceCue, Phase, PlayerCount } from './types';

const CHART_FACE_CUES: FaceCue[] = [
  { timeSec: 10, beatIndex: 16, expression: 'smile' },
  { timeSec: 20, beatIndex: 32, expression: 'pucker' },
];
const ENOUGH = FACES.sightingsToKeep;

/** Players with the Faces switch on, whose charts have face cues. */
function playersWithFaces(count: PlayerCount): FaceCheckedPlayer[] {
  const players = createPlayers(parseSettings(null, `?players=${count}`).settings);
  for (const player of players) {
    player.chartFaceCues = CHART_FACE_CUES;
    player.faceCues = CHART_FACE_CUES;
  }
  return players;
}

describe('the face check at the start of play', () => {
  it('needs 10 sightings', () => {
    expect(FACES.sightingsToKeep).toBe(10);
  });

  it('keeps the face cues of a player whose face the tracker found in enough frames', () => {
    const [solo] = playersWithFaces(1);
    solo.faceSightings = ENOUGH;
    expect(decideFaceCues([solo])).toEqual([]);
    expect(solo.faceCues).toEqual(CHART_FACE_CUES);
    expect(solo.faceCuesDropped).toBe(false);
  });

  it('drops the face cues of a player whose face the tracker found in fewer frames, such as one lucky frame', () => {
    for (const sightings of [0, 1, ENOUGH - 1]) {
      const [solo] = playersWithFaces(1);
      solo.faceSightings = sightings;
      expect(decideFaceCues([solo])).toEqual([0]);
      expect(solo.faceCues).toEqual([]);
      expect(solo.faceCuesDropped).toBe(true);
    }
  });

  it('keeps the chart’s face cues apart, so the next play decides again', () => {
    const [solo] = playersWithFaces(1);
    decideFaceCues([solo]);
    expect(solo.chartFaceCues).toEqual(CHART_FACE_CUES);
    solo.faceSightings = ENOUGH;
    decideFaceCues([solo]);
    expect(solo.faceCues).toEqual(CHART_FACE_CUES);
    expect(solo.faceCuesDropped).toBe(false);
  });

  it('drops nothing for a player with the Faces switch off', () => {
    const [solo] = createPlayers(parseSettings(null, '?players=1').settings);
    expect(decideFaceCues([solo])).toEqual([]);
    expect(solo.faceCues).toEqual([]);
    expect(solo.faceCuesDropped).toBe(false);
  });

  it('decides for each player alone', () => {
    const duo = playersWithFaces(2);
    duo[0].faceSightings = ENOUGH;
    expect(decideFaceCues(duo)).toEqual([1]);
    expect(duo[0].faceCues).toEqual(CHART_FACE_CUES);
    expect(duo[1].faceCues).toEqual([]);
  });

  it('needs the sightings again after the ready screen or the results open', () => {
    const duo = playersWithFaces(2);
    for (const player of duo) player.faceSightings = ENOUGH;
    restartFaceCheck(duo);
    expect(duo.map((player) => player.faceSightings)).toEqual([0, 0]);
    expect(decideFaceCues(duo)).toEqual([0, 1]);
  });
});

describe('a sighting', () => {
  it('counts a frame that the camera took after the screen opened', () => {
    const [solo] = playersWithFaces(1);
    countFaceSighting(solo, 5000, 5000);
    countFaceSighting(solo, 5033, 5000);
    expect(solo.faceSightings).toBe(2);
  });

  it('does not count a frame of an earlier screen or session that arrives late', () => {
    const [solo] = playersWithFaces(1);
    countFaceSighting(solo, 4999, 5000);
    expect(solo.faceSightings).toBe(0);
  });
});

describe('looking for a face before play', () => {
  const notSeen = { chartFaceCues: CHART_FACE_CUES, faceSightings: 0 };
  const moment = (phase: Phase, startHeld: boolean, decided = false): FaceCheckMoment => ({ phase, decided, startHeld });

  it('happens on the ready screen and the results while a Start hold is in progress', () => {
    for (const phase of ['ready', 'results'] as const) {
      expect(looksForFaceBeforePlay(moment(phase, true), notSeen)).toBe(true);
    }
  });

  it('does not happen on the ready screen or the results while nobody holds a Start cell', () => {
    for (const phase of ['ready', 'results'] as const) {
      expect(looksForFaceBeforePlay(moment(phase, false), notSeen)).toBe(false);
    }
  });

  it('happens during the countdown, with or without a hold', () => {
    expect(looksForFaceBeforePlay(moment('countdown', false), notSeen)).toBe(true);
  });

  it('does not happen in any other phase: play has its own rule', () => {
    for (const phase of ['menu', 'loading', 'fit', 'play', 'error'] as const) {
      expect(looksForFaceBeforePlay(moment(phase, true), notSeen)).toBe(false);
    }
  });

  it('does not happen for a player with the Faces switch off or a chart with no face cues', () => {
    const noFaceCues = { chartFaceCues: [], faceSightings: 0 };
    expect(looksForFaceBeforePlay(moment('countdown', true), noFaceCues)).toBe(false);
  });

  it('does not happen in the countdown of a restart, which keeps the decision of the round', () => {
    expect(looksForFaceBeforePlay(moment('countdown', false, true), notSeen)).toBe(false);
  });

  it('stops for a player once they have enough sightings', () => {
    const almost = { chartFaceCues: CHART_FACE_CUES, faceSightings: ENOUGH - 1 };
    const enough = { chartFaceCues: CHART_FACE_CUES, faceSightings: ENOUGH };
    expect(looksForFaceBeforePlay(moment('countdown', true), almost)).toBe(true);
    expect(looksForFaceBeforePlay(moment('countdown', true), enough)).toBe(false);
  });
});

describe('the bot and the face check', () => {
  const FRAME_MS = 1000 / 30;

  /**
   * Runs the face check on the bot's frames, at 30 frames a second, through each phase for its
   * length in ms. `startHeld` says whether the bot holds its Start cell on the ready screen.
   */
  function checkBot(phases: [Phase, number][], startHeld: boolean): FaceCheckedPlayer {
    const [solo] = playersWithFaces(1);
    const grid = defaultGrid(0, 1);
    let timeMs = 0;
    for (const [phase, lengthMs] of phases) {
      const endMs = timeMs + lengthMs;
      for (; timeMs < endMs; timeMs += FRAME_MS) {
        const asked = looksForFaceBeforePlay({ phase, decided: false, startHeld }, solo);
        const { face } = botPlayer(phase, 0, [], grid, 1, 0, CHART_FACE_CUES);
        if (asked && face) countFaceSighting(solo, timeMs, 0);
      }
    }
    return solo;
  }

  it('reaches enough sightings with its still face while it holds its Start cell', () => {
    const solo = checkBot([['ready', TIMING.readyHoldSec * 1000]], true);
    expect(solo.faceSightings).toBe(ENOUGH);
    expect(decideFaceCues([solo])).toEqual([]);
  });

  it('reaches enough sightings in the countdown alone, when Space starts the round', () => {
    const solo = checkBot([['ready', 2000], ['countdown', TIMING.countdownSec * 1000]], false);
    expect(solo.faceSightings).toBe(ENOUGH);
    expect(decideFaceCues([solo])).toEqual([]);
  });
});

describe('the note when a round has no face cues for a player', () => {
  it('speaks to the only player', () => {
    expect(facesOffText([0], 1)).toBe('Faces off: the camera cannot see your face');
  });

  it('names the player of two', () => {
    expect(facesOffText([1], 2)).toBe('P2 faces off: the camera cannot see your face');
  });

  it('names both players of two', () => {
    expect(facesOffText([0, 1], 2)).toBe('P1 and P2 faces off: the camera cannot see your faces');
  });

  it('is nothing when every player keeps their face cues', () => {
    expect(facesOffText([], 2)).toBeNull();
  });
});
