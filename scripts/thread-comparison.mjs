// Compares the frame logs of two runs on one camera file: which camera frames both runs
// tracked, and how far their hands differ on those frames. Pure functions, for
// scripts/compare-threads.mjs and its tests.

/** The value below which `share` of the numbers lie: 0.5 gives the median. Null for an empty list. */
function quantile(values, share) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))];
}

const round = (value, decimals = 4) => (value === null ? null : Number(value.toFixed(decimals)));
const shareOf = (count, total) => (total ? round(count / total, 3) : null);

const hasStreamTime = (frame) => typeof frame.videoTimeSec === 'number';

/**
 * The steady part of the camera stream's frame times, as a fraction of a frame, in -0.5..0.5.
 * Chrome's file camera gives frame k a stream time of about (k + offset) / fps, with a little
 * jitter. The offset is the circular mean of the fractional parts: a plain median breaks when
 * the parts lie near a whole frame, at 0.98 and 0.02 alike. It comes from all the runs given,
 * because one shared value numbers the same camera frame alike in every run.
 */
export function streamOffset(fps, ...runs) {
  let cos = 0;
  let sin = 0;
  for (const frame of runs.flat().filter(hasStreamTime)) {
    const angle = 2 * Math.PI * (frame.videoTimeSec * fps);
    cos += Math.cos(angle);
    sin += Math.sin(angle);
  }
  return cos === 0 && sin === 0 ? 0 : Math.atan2(sin, cos) / (2 * Math.PI);
}

/**
 * Numbers each logged frame by the camera frame it came from: frames since the camera stream
 * started. `offset` is the `streamOffset` of the runs that are compared.
 *
 * Returns a Map from frame number to logged frame. Frames with no stream time are left out.
 */
export function numberFrames(frames, fps, offset) {
  const numbered = new Map();
  for (const frame of frames.filter(hasStreamTime)) {
    const number = Math.round(frame.videoTimeSec * fps - offset);
    if (!numbered.has(number)) numbered.set(number, frame);
  }
  return numbered;
}

/** Distance between two points of the frame, in frame heights. `aspect` is width over height. */
export function frameDistance(a, b, aspect) {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

/** Pairs the hands of two runs, nearest first. Hands with no partner stay out. */
export function pairHands(handsA, handsB, aspect) {
  const candidates = [];
  handsA.forEach((a, i) => handsB.forEach((b, j) => candidates.push({ i, j, distance: frameDistance(a, b, aspect) })));
  candidates.sort((x, y) => x.distance - y.distance);
  const usedA = new Set();
  const usedB = new Set();
  const pairs = [];
  for (const { i, j, distance } of candidates) {
    if (usedA.has(i) || usedB.has(j)) continue;
    usedA.add(i);
    usedB.add(j);
    pairs.push({ a: handsA[i], b: handsB[j], distance });
  }
  return pairs;
}

/**
 * How far the hands of two runs differ, on the camera frames both runs tracked.
 * `shift` compares frame n of run A with frame n + shift of run B, to check the frame matching.
 */
export function compareRuns(framesA, framesB, { fps, aspect, shift = 0 }) {
  const offset = streamOffset(fps, framesA, framesB);
  const numberedA = numberFrames(framesA, fps, offset);
  const numberedB = numberFrames(framesB, fps, offset);
  let matchedFrames = 0;
  let otherMode = 0;
  let playerSlots = 0;
  let sameHandCount = 0;
  let pairedHands = 0;
  let sameGesture = 0;
  let facesCompared = 0;
  const palmDistances = [];
  const sizeDifferences = [];
  const expressionDifferences = [];
  const faceDistances = [];

  for (const [number, a] of numberedA) {
    const b = numberedB.get(number + shift);
    if (!b) continue;
    // Only the same tracker gives comparable hands.
    if (a.mode !== b.mode) {
      otherMode++;
      continue;
    }
    matchedFrames++;
    a.players.forEach((playerA, slot) => {
      const playerB = b.players[slot];
      playerSlots++;
      if (playerA.hands.length === playerB.hands.length) sameHandCount++;
      for (const pair of pairHands(playerA.hands, playerB.hands, aspect)) {
        pairedHands++;
        palmDistances.push(pair.distance);
        sizeDifferences.push(Math.abs(pair.a.size - pair.b.size));
        if (pair.a.gesture === pair.b.gesture) sameGesture++;
      }
      if (playerA.face && playerB.face) {
        facesCompared++;
        faceDistances.push(frameDistance(playerA.face, playerB.face, aspect));
        for (const [name, value] of Object.entries(playerA.face.expressions)) {
          expressionDifferences.push(Math.abs(value - playerB.face.expressions[name]));
        }
      }
    });
  }

  const spread = (values) => ({
    median: round(quantile(values, 0.5)),
    p95: round(quantile(values, 0.95)),
    max: round(values.length ? Math.max(...values) : null),
  });
  return {
    framesA: numberedA.size,
    framesB: numberedB.size,
    matchedFrames,
    /** Frames both runs tracked, but with different tracker modes. Left out. */
    otherMode,
    /** Share of player slots, over matched frames, where both runs saw as many hands. */
    sameHandCount: shareOf(sameHandCount, playerSlots),
    pairedHands,
    /** Palm centre distance between paired hands, in frame heights. */
    palmDistance: spread(palmDistances),
    /** Difference in hand size, in frame heights. */
    sizeDifference: spread(sizeDifferences),
    sameGesture: shareOf(sameGesture, pairedHands),
    facesCompared,
    faceDistance: spread(faceDistances),
    /** Difference in each expression's strength, 0..1. */
    expressionDifference: spread(expressionDifferences),
  };
}

/**
 * The palm distance for frame shifts from -range to +range. With good matching the median
 * is lowest at shift 0, because hands move between frames.
 */
export function shiftCheck(framesA, framesB, { fps, aspect, range = 2 }) {
  const result = [];
  for (let shift = -range; shift <= range; shift++) {
    const { matchedFrames, palmDistance } = compareRuns(framesA, framesB, { fps, aspect, shift });
    result.push({ shift, matchedFrames, medianPalmDistance: palmDistance.median });
  }
  return result;
}
