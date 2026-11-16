import { describe, expect, it } from 'vitest';
import { decideFaceCues, facesOffText, looksForFaceBeforePlay, restartFaceCheck } from './faceCheck';
import type { FaceCheckedPlayer } from './faceCheck';
import { createPlayers } from './player';
import { parseSettings } from './settings';
import type { FaceCue, Phase, PlayerCount } from './types';

const CHART_FACE_CUES: FaceCue[] = [
  { timeSec: 10, beatIndex: 16, expression: 'smile' },
  { timeSec: 20, beatIndex: 32, expression: 'pucker' },
];

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
  it('keeps the face cues of a player whose face the camera has seen', () => {
    const [solo] = playersWithFaces(1);
    solo.faceSeenSinceScreen = true;
    expect(decideFaceCues([solo])).toEqual([]);
    expect(solo.faceCues).toEqual(CHART_FACE_CUES);
    expect(solo.faceCuesDropped).toBe(false);
  });

  it('drops the face cues of a player whose face the camera has not seen', () => {
    const [solo] = playersWithFaces(1);
    expect(decideFaceCues([solo])).toEqual([0]);
    expect(solo.faceCues).toEqual([]);
    expect(solo.faceCuesDropped).toBe(true);
  });

  it('keeps the chart’s face cues apart, so the next play decides again', () => {
    const [solo] = playersWithFaces(1);
    decideFaceCues([solo]);
    expect(solo.chartFaceCues).toEqual(CHART_FACE_CUES);
    solo.faceSeenSinceScreen = true;
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
    duo[0].faceSeenSinceScreen = true;
    expect(decideFaceCues(duo)).toEqual([1]);
    expect(duo[0].faceCues).toEqual(CHART_FACE_CUES);
    expect(duo[1].faceCues).toEqual([]);
  });

  it('needs the face again after the ready screen or the results open', () => {
    const duo = playersWithFaces(2);
    for (const player of duo) player.faceSeenSinceScreen = true;
    restartFaceCheck(duo);
    expect(duo.map((player) => player.faceSeenSinceScreen)).toEqual([false, false]);
    expect(decideFaceCues(duo)).toEqual([0, 1]);
  });
});

describe('looking for a face before play', () => {
  const beforePlay: Phase[] = ['ready', 'results', 'countdown'];
  const otherPhases: Phase[] = ['menu', 'loading', 'fit', 'play', 'error'];
  const notSeen = { chartFaceCues: CHART_FACE_CUES, faceSeenSinceScreen: false };

  it('happens on the ready screen, the results and the countdown, for a chart with face cues', () => {
    for (const phase of beforePlay) {
      expect(looksForFaceBeforePlay(phase, notSeen, false)).toBe(true);
    }
  });

  it('does not happen in any other phase: play has its own rule', () => {
    for (const phase of otherPhases) {
      expect(looksForFaceBeforePlay(phase, notSeen, false)).toBe(false);
    }
  });

  it('does not happen for a player with the Faces switch off or a chart with no face cues', () => {
    const noFaceCues = { chartFaceCues: [], faceSeenSinceScreen: false };
    for (const phase of beforePlay) {
      expect(looksForFaceBeforePlay(phase, noFaceCues, false)).toBe(false);
    }
  });

  it('does not happen in the countdown of a restart, which keeps the decision of the round', () => {
    expect(looksForFaceBeforePlay('countdown', notSeen, true)).toBe(false);
  });

  it('stops once the camera has seen the face: one sighting decides', () => {
    const seen = { chartFaceCues: CHART_FACE_CUES, faceSeenSinceScreen: true };
    for (const phase of beforePlay) {
      expect(looksForFaceBeforePlay(phase, seen, false)).toBe(false);
    }
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
