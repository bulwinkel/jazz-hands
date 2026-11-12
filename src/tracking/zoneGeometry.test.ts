import { describe, expect, it } from 'vitest';
import { cropLandmarksToFrame, handsInZone, zoneCrop, zoneOfX } from './zoneGeometry';
import type { TrackedHand } from './types';

const WIDTH = 1920;
const HEIGHT = 1080;

function hand(x: number, size: number): TrackedHand {
  return { x, y: 0.5, size, gesture: 'none', gestureScore: 0 };
}

describe('zone of a position', () => {
  it('counts zones from the left of the mirrored frame', () => {
    expect(zoneOfX(0.1, 3)).toBe(0);
    expect(zoneOfX(0.5, 3)).toBe(1);
    expect(zoneOfX(0.9, 3)).toBe(2);
    expect(zoneOfX(0.8, 4)).toBe(3);
  });

  it('gives a position on a border to the zone on its right', () => {
    expect(zoneOfX(0.5, 4)).toBe(2);
    expect(zoneOfX(0.25, 4)).toBe(1);
  });

  it('counts a position outside the frame to the zone at that edge', () => {
    expect(zoneOfX(-0.02, 3)).toBe(0);
    expect(zoneOfX(1, 3)).toBe(2);
    expect(zoneOfX(1.04, 4)).toBe(3);
  });

  it('puts every position in zone 0 when there is one zone', () => {
    expect(zoneOfX(0.01, 1)).toBe(0);
    expect(zoneOfX(0.99, 1)).toBe(0);
  });
});

describe('crop of a zone', () => {
  it('takes the rightmost part of the camera frame for zone 0, because the screen is mirrored', () => {
    expect(zoneCrop(0, 3, WIDTH, HEIGHT, 0)).toEqual({ x: 1280, y: 0, width: 640, height: HEIGHT });
    expect(zoneCrop(2, 3, WIDTH, HEIGHT, 0)).toEqual({ x: 0, y: 0, width: 640, height: HEIGHT });
  });

  it('reaches a tenth of a zone into both neighbours', () => {
    expect(zoneCrop(1, 3, WIDTH, HEIGHT)).toEqual({ x: 576, y: 0, width: 768, height: HEIGHT });
    expect(zoneCrop(1, 4, WIDTH, HEIGHT)).toEqual({ x: 912, y: 0, width: 576, height: HEIGHT });
  });

  it('stops at the edges of the frame', () => {
    expect(zoneCrop(0, 3, WIDTH, HEIGHT)).toEqual({ x: 1216, y: 0, width: 704, height: HEIGHT });
    expect(zoneCrop(2, 3, WIDTH, HEIGHT)).toEqual({ x: 0, y: 0, width: 704, height: HEIGHT });
  });

  it('is the whole frame for one zone', () => {
    expect(zoneCrop(0, 1, WIDTH, HEIGHT)).toEqual({ x: 0, y: 0, width: WIDTH, height: HEIGHT });
  });

  it.each([3, 4])('covers a frame that does not divide evenly by %i, with no gap', (zones) => {
    const oddWidth = 1279;
    const crops = Array.from({ length: zones }, (_, zone) => zoneCrop(zone, zones, oddWidth, 720, 0));
    // Zone 0 is the rightmost crop, so walk the zones from the last to the first.
    let coveredTo = 0;
    for (const crop of crops.reverse()) {
      expect(crop.x).toBe(coveredTo);
      coveredTo = crop.x + crop.width;
    }
    expect(coveredTo).toBe(oddWidth);
  });
});

describe('landmarks from a crop', () => {
  it('land where they are in the full mirrored frame', () => {
    const crop = zoneCrop(1, 3, WIDTH, HEIGHT);
    // The centre of the middle crop is the centre of the frame.
    const [centre] = cropLandmarksToFrame([{ x: 0.5, y: 0.5 }], crop, WIDTH, HEIGHT);
    expect(centre.x).toBeCloseTo(0.5);
    expect(centre.y).toBeCloseTo(0.5);
  });

  it('are mirrored: the left edge of a crop is its right edge on screen', () => {
    const crop = zoneCrop(0, 4, WIDTH, HEIGHT, 0);
    const [left, right] = cropLandmarksToFrame([{ x: 0, y: 0.2 }, { x: 1, y: 0.8 }], crop, WIDTH, HEIGHT);
    expect(left).toEqual({ x: 0.25, y: 0.2 });
    expect(right).toEqual({ x: 0, y: 0.8 });
  });

  it('agree between two crops that both show the same camera pixel', () => {
    const cameraX = 1250; // In the overlap of zones 0 and 1.
    const inCrop = (zone: number) => {
      const crop = zoneCrop(zone, 3, WIDTH, HEIGHT);
      const landmark = { x: (cameraX - crop.x) / crop.width, y: 0.4 };
      return cropLandmarksToFrame([landmark], crop, WIDTH, HEIGHT)[0];
    };
    expect(inCrop(0).x).toBeCloseTo(1 - cameraX / WIDTH);
    expect(inCrop(1).x).toBeCloseTo(inCrop(0).x);
  });
});

describe('hands of a zone', () => {
  it('keeps the hands with the palm centre in the zone', () => {
    const hands = [hand(0.1, 0.2), hand(0.4, 0.2), hand(0.6, 0.2), hand(0.9, 0.2)];
    expect(handsInZone(hands, 1, 3).map((kept) => kept.x)).toEqual([0.4, 0.6]);
    expect(handsInZone(hands, 2, 3).map((kept) => kept.x)).toEqual([0.9]);
  });

  it('keeps the largest two, the largest first', () => {
    const hands = [hand(0.1, 0.05), hand(0.2, 0.3), hand(0.15, 0.1), hand(0.3, 0.2)];
    expect(handsInZone(hands, 0, 3).map((kept) => kept.size)).toEqual([0.3, 0.2]);
  });

  it('drops a hand that a crop sees in its overlap, so the neighbour zone alone reports it', () => {
    // The palm centre is in zone 1. The crops of zone 0 and zone 1 both show it.
    const seenByBothCrops = [hand(0.35, 0.2)];
    expect(handsInZone(seenByBothCrops, 0, 3)).toEqual([]);
    expect(handsInZone(seenByBothCrops, 1, 3)).toHaveLength(1);
  });

  it('does not change the list it is given', () => {
    const hands = [hand(0.1, 0.1), hand(0.2, 0.3)];
    handsInZone(hands, 0, 2);
    expect(hands.map((kept) => kept.size)).toEqual([0.1, 0.3]);
  });

  it('drops a hand with no position', () => {
    expect(handsInZone([hand(Number.NaN, 0.2)], 0, 2)).toEqual([]);
  });
});
