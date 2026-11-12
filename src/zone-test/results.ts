import { HANDS_HIDDEN_PHASE, HANDS_SHOWN_PHASE } from './config';
import { bothHandsShare, shapeMatchShare } from './estimate';
import type { PhaseReport, VariantReport, ZoneTestReport } from './report';

/** A value that could not be measured. */
const NO_VALUE = '—';

function percent(share: number | null): string {
  return share === null ? NO_VALUE : `${Math.round(share * 100)}%`;
}

function milliseconds(value: number | null): string {
  return value === null ? NO_VALUE : `${value.toFixed(1)} ms`;
}

function framesPerSec(value: number | null): string {
  return value === null ? NO_VALUE : `${value.toFixed(1)} fps`;
}

/** The zones with a person, counted from 1 as on screen. */
function zoneList(zones: readonly number[]): string {
  if (zones.length === 0) return 'no person found';
  return `person in zone ${zones.map((zone) => zone + 1).join(' and ')}`;
}

/** How often both hands were found in one phase, and how often their shape was read right. */
function detectionCell(variant: VariantReport, phase: PhaseReport): string {
  const occupied = variant.derived.occupiedZones;
  const found = percent(bothHandsShare(phase, occupied));
  if (phase.expectedShape === null || occupied.length === 0) return `<td>${found}</td>`;

  const fromFingers = `<small>shape ${percent(shapeMatchShare(phase, occupied, 'shapeMatch'))}</small>`;
  const fromModel =
    variant.model === 'gesture'
      ? `<small>MediaPipe ${percent(shapeMatchShare(phase, occupied, 'modelLabelMatch'))}</small>`
      : '';
  return `<td>${found}${fromFingers}${fromModel}</td>`;
}

function variantRow(variant: VariantReport): string {
  const { derived, phases } = variant;
  const handsHidden = phases[HANDS_HIDDEN_PHASE];
  const handsShown = phases[HANDS_SHOWN_PHASE];
  const withHands = phases.filter((_phase, index) => index !== HANDS_HIDDEN_PHASE);

  return `
    <tr>
      <th scope="row">
        ${variant.layout} · ${variant.model}
        <small>${variant.delegate} · ${zoneList(derived.occupiedZones)}</small>
      </th>
      ${withHands.map((phase) => detectionCell(variant, phase)).join('')}
      <td>${milliseconds(handsHidden.inferenceMs.mean)}</td>
      <td>${milliseconds(handsShown.inferenceMs.mean)}<small>${framesPerSec(handsShown.framesPerSec)}</small></td>
      <td class="estimate">
        ${milliseconds(derived.estimate.everyHandTrackedMs)}
        <small>${framesPerSec(derived.estimate.everyHandTrackedFps)}</small>
      </td>
      <td class="estimate">
        ${milliseconds(derived.estimate.withDetectorMs)}
        <small>${framesPerSec(derived.estimate.withDetectorFps)}</small>
      </td>
    </tr>`;
}

function variantNotes(variant: VariantReport): string {
  return `<li><strong>${variant.layout} · ${variant.model}:</strong> ${variant.derived.notes.join(' ')}</li>`;
}

/** The results screen: one row for each variant, and below it how each estimate was made. */
export function resultsHtml(report: ZoneTestReport): string {
  const [firstVariant] = report.variants;
  const phasesWithHands = firstVariant.phases.filter((_phase, index) => index !== HANDS_HIDDEN_PHASE);
  const { camera } = report;

  return `
    <h1>Zone test done · ${report.zones} zones</h1>
    <p>Camera ${camera.width}×${camera.height}. ${report.caveat}</p>
    <table>
      <thead>
        <tr>
          <th rowspan="2" scope="col">Tracker</th>
          <th colspan="${phasesWithHands.length}" scope="colgroup">Both hands found, where a person stood</th>
          <th colspan="2" scope="colgroup">Measured, one frame</th>
          <th colspan="2" scope="colgroup">Estimate, every zone full</th>
        </tr>
        <tr>
          ${phasesWithHands.map((phase) => `<th scope="col">${phase.instruction}</th>`).join('')}
          <th scope="col">No hands</th>
          <th scope="col">Open hands</th>
          <th scope="col">All hands tracked</th>
          <th scope="col">Detector running</th>
        </tr>
      </thead>
      <tbody>${report.variants.map(variantRow).join('')}</tbody>
    </table>
    <h2>How each estimate was made</h2>
    <ul>${report.variants.map(variantNotes).join('')}</ul>`;
}
