import type { TrackerDelegate, TrackerMode } from '../tracking/types';
import type { TRACKING_THRESHOLDS } from '../tracking/config';
import type { PhaseResult } from './benchmark';

export interface BenchmarkResult {
  schemaVersion: 1;
  timestamp: string;
  userAgent: string;
  camera: { width: number; height: number; frameRate: number | null };
  delegates: Record<TrackerMode, TrackerDelegate>;
  thresholds: typeof TRACKING_THRESHOLDS;
  phases: PhaseResult[];
}

const percent = (value: number | null) => value === null ? '—' : `${(value * 100).toFixed(0)}%`;
const number = (value: number | null, digits = 1) => value === null ? '—' : value.toFixed(digits);

export function renderResults(result: BenchmarkResult, host: HTMLElement): void {
  host.replaceChildren();
  const title = document.createElement('h1');
  title.textContent = 'Benchmark complete';
  const note = document.createElement('p');
  note.textContent = 'P0 = cyan, left. P1 = magenta, right. Gesture match uses detected hands. — = no measurement or unsupported.';
  const scroll = document.createElement('div');
  scroll.className = 'table-scroll';
  scroll.tabIndex = 0;
  const table = document.createElement('table');
  const caption = table.createCaption();
  caption.textContent = 'Each row shows one player half in a five-second phase.';
  const header = table.createTHead().insertRow();
  for (const label of ['Mode / phase', 'Player', 'Frames', '=2 hands', '≥2 hands', '≥1 hand',
    'Mean hands', 'Gesture match', 'Gesture score', 'Hand size¹', 'FPS', 'Mean ms', 'p95 ms']) {
    const cell = document.createElement('th');
    cell.scope = 'col'; cell.textContent = label; header.append(cell);
  }
  const body = table.createTBody();
  for (const phase of result.phases) {
    phase.players.forEach((stats, player) => {
      const row = body.insertRow();
      row.className = `player-${player}`;
      const values = [`${phase.mode} / ${phase.phase}. ${phase.instruction}`, `P${player}`,
        String(stats.recordedFrameCount), percent(stats.exactlyTwoHandsFraction),
        percent(stats.atLeastTwoHandsFraction), percent(stats.atLeastOneHandFraction),
        number(stats.meanHandsDetected, 2), percent(stats.gestureMatchFraction),
        number(stats.meanGestureScore, 2), number(stats.meanHandSize, 3),
        number(stats.fps), number(stats.meanInferenceMs), number(stats.p95InferenceMs)];
      values.forEach((value, index) => {
        const cell = index === 0 ? document.createElement('th') : document.createElement('td');
        if (cell instanceof HTMLTableCellElement && index === 0) cell.scope = 'row';
        cell.textContent = value; row.append(cell);
      });
    });
  }
  scroll.append(table);
  const footnote = document.createElement('p');
  footnote.textContent = '¹ Hand size is the bounding-box diagonal divided by frame height. Pose uses four hand landmarks; hand modes use 21. Inference includes all models and crop work for one processed frame. FPS counts processed frames per five-second window.';
  host.append(title, note, scroll, footnote);
}
