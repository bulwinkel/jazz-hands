/**
 * Where a report goes when a run ends: to the dev server, which writes it to test-results/,
 * and into this browser as a spare. A report that did not reach the server is sent again the
 * next time the page loads, so a run is not lost when the server was down for a moment.
 */

const REPORT_KEY = 'zone-test-last-report';
/** '1' once the kept report is on disk. */
const ON_DISK_KEY = 'zone-test-last-report-on-disk';
const SAVE_URL = '/__tracking-results';
const SAVE_TIMEOUT_MS = 15_000;

/** The last report kept in this browser, or null. */
export function keptReport(): string | null {
  try {
    return localStorage.getItem(REPORT_KEY);
  } catch {
    return null; // Storage can be blocked. The report is then only on screen.
  }
}

function isOnDisk(): boolean {
  try {
    return localStorage.getItem(ON_DISK_KEY) === '1';
  } catch {
    return false;
  }
}

function markOnDisk(onDisk: boolean): void {
  try {
    localStorage.setItem(ON_DISK_KEY, onDisk ? '1' : '0');
  } catch {
    // Storage can be blocked. The worst case is one more copy of the report on disk.
  }
}

/** Keeps a new report in this browser. False when the browser refused. */
export function keepReport(json: string): boolean {
  try {
    localStorage.setItem(REPORT_KEY, json);
    markOnDisk(false);
    return true;
  } catch {
    return false;
  }
}

/** Sends a report to the dev server and returns the path of the file it wrote. */
export async function sendReport(json: string): Promise<string> {
  const response = await fetch(SAVE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: json,
    signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`The server answered ${response.status}.`);

  const saved: { path?: unknown } = await response.json();
  if (typeof saved.path !== 'string') throw new Error('The server gave no file path.');
  markOnDisk(true);
  return saved.path;
}

/**
 * Sends the kept report again when it never reached the server.
 * Returns the path of the file, or null when there was nothing to send.
 */
export async function resendKeptReport(): Promise<string | null> {
  const json = keptReport();
  if (json === null || isOnDisk()) return null;
  return sendReport(json);
}
