import { TRACKING_THRESHOLDS } from '../tracking/config';
import type { GestureName } from '../tracking/types';
import { CROP_OVERLAP } from '../tracking/zoneGeometry';
import type { ZoneLayout, ZoneModel, ZoneTracker } from '../tracking/zones';
import { ASSUMED_CAMERA_FPS, HANDS_HIDDEN_PHASE, HANDS_SHOWN_PHASE, OCCUPIED_SHARE, PHASES, VARIANTS } from './config';
import type { Timing } from './config';
import { deriveVariant } from './estimate';
import type { VariantDerived } from './estimate';
import type { PhaseSummary } from './statistics';

/** The file a run leaves in test-results/. Everything about the run is in it. */
export interface ZoneTestReport {
  kind: 'zone-test';
  schemaVersion: 1;
  savedAt: string;
  userAgent: string;
  camera: CameraInfo;
  zones: number;
  /** True for a `?quick=1` run, which is too short to measure anything. */
  quick: boolean;
  timing: Timing;
  thresholds: {
    handDetection: number;
    handPresence: number;
    tracking: number;
    /** How far a zone's crop reaches into its neighbours, as a share of the zone width. */
    cropOverlap: number;
    /** A zone has a person when a hand was seen there in more than this share of frames. */
    occupiedShare: number;
  };
  /** What to know before the estimates are used. */
  caveat: string;
  variants: VariantReport[];
}

export interface CameraInfo {
  width: number;
  height: number;
  /** Null when the browser does not report the rate. */
  frameRate: number | null;
}

export interface VariantReport {
  layout: ZoneLayout;
  model: ZoneModel;
  /** Where the models ran: `GPU` or `CPU`. */
  delegate: string;
  modelCount: number;
  handsPerModel: number;
  phases: PhaseReport[];
  derived: VariantDerived;
}

export interface PhaseReport extends PhaseSummary {
  /** Counted from 1, as on screen. */
  phase: number;
  instruction: string;
  expectedShape: GestureName | null;
}

export interface ReportInput {
  zones: number;
  quick: boolean;
  timing: Timing;
  camera: CameraInfo;
  userAgent: string;
  savedAt: Date;
  /** The tracker of each variant, in the order of VARIANTS. */
  trackers: readonly Pick<ZoneTracker, 'delegate' | 'modelCount' | 'handsPerModel'>[];
  /** The phase summaries of each variant, in the order of VARIANTS. */
  summaries: readonly (readonly PhaseSummary[])[];
}

const ESTIMATE_CAVEAT =
  'The times for every zone full are estimates. They are worked out from the few hands in view, ' +
  'not measured with a player in every zone. The notes of each variant say how many hands they rest on. ' +
  'An estimated frame rate is 1000 divided by the frame time. The real rate is lower when that time ' +
  'is close to the time between two camera frames: a frame that is late waits for the next one.';
const QUICK_CAVEAT = 'This was a quick run for automated checks. It is too short for its numbers to mean anything.';

function variantReport(input: ReportInput, variantIndex: number): VariantReport {
  const variant = VARIANTS[variantIndex];
  const tracker = input.trackers[variantIndex];
  const summaries = input.summaries[variantIndex];

  return {
    ...variant,
    delegate: tracker.delegate,
    modelCount: tracker.modelCount,
    handsPerModel: tracker.handsPerModel,
    phases: summaries.map((summary, phase) => ({
      phase: phase + 1,
      instruction: PHASES[phase].instruction,
      expectedShape: PHASES[phase].expectedShape,
      ...summary,
    })),
    derived: deriveVariant({
      layout: variant.layout,
      zones: input.zones,
      handsHidden: summaries[HANDS_HIDDEN_PHASE],
      handsShown: summaries[HANDS_SHOWN_PHASE],
      cameraFps: input.camera.frameRate ?? ASSUMED_CAMERA_FPS,
    }),
  };
}

/** Puts a finished run together as plain data that can be saved as JSON. */
export function buildReport(input: ReportInput): ZoneTestReport {
  return {
    kind: 'zone-test',
    schemaVersion: 1,
    savedAt: input.savedAt.toISOString(),
    userAgent: input.userAgent,
    camera: input.camera,
    zones: input.zones,
    quick: input.quick,
    timing: input.timing,
    thresholds: {
      handDetection: TRACKING_THRESHOLDS.detection,
      handPresence: TRACKING_THRESHOLDS.presence,
      tracking: TRACKING_THRESHOLDS.tracking,
      cropOverlap: CROP_OVERLAP,
      occupiedShare: OCCUPIED_SHARE,
    },
    caveat: input.quick ? `${QUICK_CAVEAT} ${ESTIMATE_CAVEAT}` : ESTIMATE_CAVEAT,
    variants: VARIANTS.map((_variant, index) => variantReport(input, index)),
  };
}
