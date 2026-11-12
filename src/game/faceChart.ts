import type { FaceExpression } from '../tracking/types';
import { seededRandom } from './chart';
import { FACES } from './config';
import { leadInEndSec, tailStartSec } from './manifest';
import type { FaceCue, Manifest } from './types';

/**
 * Face cues draw their random numbers from a stream of their own.
 * The hand charts are then the same with faces on or off.
 */
const FACE_SEED_STREAM = 0xface;

/**
 * The face cues of a song: one on a bar start every few bars, where the music is strong enough.
 * The same manifest, seed and end always give the same list. The list does not depend on the
 * level, so two players with faces on pull the same face on the same beat.
 */
export function generateFaceCues(manifest: Manifest, seed: number, endSec: number): FaceCue[] {
  const random = seededRandom(seed ^ FACE_SEED_STREAM);
  const firstCueSec = leadInEndSec(manifest);
  const tailSec = tailStartSec(manifest, endSec);
  const beatsBetweenCues = FACES.everyBars * manifest.beatsPerBar;

  const cues: FaceCue[] = [];
  let previous: FaceExpression | undefined;

  for (let beat = manifest.firstDownbeat; beat < manifest.beats.length; beat += beatsBetweenCues) {
    // Every candidate bar takes a roll, used or not. The Short length then has the same
    // faces as the start of the Full length.
    const roll = random();
    const timeSec = manifest.beats[beat];
    const insidePlay = timeSec >= firstCueSec && timeSec < tailSec;
    if (!insidePlay || manifest.intensity[beat] < FACES.minIntensity) continue;

    const fresh = FACES.pool.filter((expression) => expression !== previous);
    // A pool of one expression has nothing fresh to offer, so it repeats.
    const choices = fresh.length > 0 ? fresh : FACES.pool;
    const expression = choices[Math.floor(roll * choices.length)];

    cues.push({ timeSec, beatIndex: beat, expression });
    previous = expression;
  }
  return cues;
}
