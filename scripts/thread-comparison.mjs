// Compares the frame logs of two runs on one camera file: which camera frames both runs
// tracked, and how far their hands differ on those frames. Pure functions, for
// scripts/compare-threads.mjs and its tests.

/** The middle value of a list of numbers. Null for an empty list. */
function quantile(values, share) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))];
}

const round = (value, decimals = 4) => (value === null ? null : Number(value.toFixed(decimals)));
const shareOf = (count, total) => (total ? round(count / total, 3) : null);

/**
 * Numbers each logged frame by the camera frame it came from: frames since the camera stream
 * started. Chrome's file camera gives frame k a stream time of about k / fps plus a small,
 * steady offset with some jitter. The offset is the median of the fractional parts, so
 * rounding after it lands on k. A constant whole-frame offset is the same in both runs.
 *
 * Returns a Map from frame number to logged frame. Frames with no stream time are left out.
 */
export function numberFrames(frames, fps) {
  const timed = frames.filter((frame) => typeof frame.videoTimeSec === 'number');
  const positions = timed.map((frame) => frame.videoTimeSec * fps);
  const offset = quantile(positions.map((position) => position - Math.floor(position)), 0.5) ?? 0;
  const numbered = new Map();
  timed.forEach((frame, i) => {
    const number = Math.round(positions[i] - offset);
    if (!numbered.has(number)) numbered.set(number, frame);
  });
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
  const numberedA = numberFrames(framesA, fps);
  const numberedB = numberFrames(framesB, fps);
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
