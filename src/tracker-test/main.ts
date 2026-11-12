import { createTracker, startCamera, TRACKER_MODES, TRACKING_THRESHOLDS } from '../tracking';
import type { Tracker, TrackerMode, TrackingFrame } from '../tracking';
import { BenchmarkSession } from './benchmark';
import { mean } from './statistics';
import { renderResults } from './results';
import type { BenchmarkResult } from './results';
import './style.css';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main id="stage" aria-label="Mirrored camera tracker test">
    <canvas id="overlay" aria-hidden="true"></canvas>
    <div id="hud" role="status" aria-live="off">Starting camera…</div>
    <div id="player-labels"><span class="player-0">P0 · LEFT</span><span class="player-1">P1 · RIGHT</span></div>
    <section id="cue" hidden aria-label="Benchmark instruction">
      <div id="cue-mode"></div><div id="cue-stage"></div>
      <div id="cue-instruction"></div><div id="cue-number"></div>
      <progress id="progress" max="1" value="0" aria-label="Benchmark progress"></progress>
    </section>
    <div id="message" role="status">Allow camera access. Stand 2 to 2.5 m away.</div>
  </main>
  <section id="results" hidden aria-label="Benchmark results"></section>
  <footer>
    <div id="controls">
      <button id="start" disabled>Start benchmark · B</button>
      <button id="fullscreen">Fullscreen · F</button>
      <button id="copy" disabled>Copy JSON</button>
      <button id="back" hidden>Back to camera</button>
    </div>
    <div id="keys">1 Full hands · 2 Split hands · 3 Pose · B Benchmark · F Fullscreen</div>
    <div id="save-status" role="status" aria-live="polite"></div>
  </footer>`;

function element<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
const stage = element<HTMLElement>('stage');
const canvas = element<HTMLCanvasElement>('overlay');
const context = canvas.getContext('2d')!;
const hud = element<HTMLElement>('hud');
const message = element<HTMLElement>('message');
const cue = element<HTMLElement>('cue');
const cueMode = element<HTMLElement>('cue-mode');
const cueStage = element<HTMLElement>('cue-stage');
const cueInstruction = element<HTMLElement>('cue-instruction');
const cueNumber = element<HTMLElement>('cue-number');
const progress = element<HTMLProgressElement>('progress');
const startButton = element<HTMLButtonElement>('start');
const copyButton = element<HTMLButtonElement>('copy');
const backButton = element<HTMLButtonElement>('back');
const resultsHost = element<HTMLElement>('results');
const saveStatus = element<HTMLElement>('save-status');
const trackers = new Map<TrackerMode, Tracker>();
let video: HTMLVideoElement | undefined;
let active: Tracker | undefined;
let benchmark: BenchmarkSession | undefined;
let preparing = false;
let stopped = false;
let switchVersion = 0;
let recent: TrackingFrame[] = [];
let latest: TrackingFrame | undefined;
let lastHudMs = 0;
let audio: AudioContext | undefined;
let wakeLock: WakeLockSentinel | undefined;
let rafId = 0;
let videoCallbackId = 0;
let fallbackRafId = 0;
let lastVideoTime = -1;
let lastPresentedFrame = -1;
let cameraInfo: BenchmarkResult['camera'] = { width: 0, height: 0, frameRate: null };
let lastJson: string | undefined;
const STORAGE_KEY = 'dance-tracker-last-result';
try { lastJson = localStorage.getItem(STORAGE_KEY) ?? undefined; } catch { /* Storage can be disabled. */ }
copyButton.disabled = !lastJson;

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function setActive(tracker: Tracker): void {
  if (active === tracker) return;
  active = tracker; recent = []; latest = undefined; lastHudMs = 0;
}
async function loadTracker(mode: TrackerMode): Promise<Tracker> {
  let tracker = trackers.get(mode);
  if (!tracker) { tracker = createTracker(mode); trackers.set(mode, tracker); }
  await tracker.init();
  return tracker;
}
async function switchMode(mode: TrackerMode): Promise<void> {
  if (benchmark || preparing || stopped) return;
  const version = ++switchVersion;
  message.textContent = `Loading ${mode}…`;
  try {
    const tracker = await loadTracker(mode);
    if (version !== switchVersion || benchmark || preparing || stopped) return;
    setActive(tracker);
    message.textContent = 'Stand 2 to 2.5 m away. Press B for the 113-second benchmark.';
    startButton.disabled = !video;
  } catch (error) {
    if (version === switchVersion) message.textContent = `Cannot load ${mode}: ${errorText(error)}`;
  }
}

function speak(instruction: string): void {
  if (!('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(instruction);
    utterance.rate = 0.95;
    speechSynthesis.speak(utterance);
  } catch { /* Visual cues remain available when speech is blocked. */ }
}
function beep(): void {
  if (!audio || audio.state !== 'running') return;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.frequency.value = 880;
  gain.gain.setValueAtTime(0.15, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.15);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(); oscillator.stop(audio.currentTime + 0.16);
}

async function startBenchmark(): Promise<void> {
  if (!video || benchmark || preparing || stopped) return;
  preparing = true; ++switchVersion; startButton.disabled = true;
  resultsHost.hidden = true; stage.hidden = false; backButton.hidden = true;
  saveStatus.textContent = '';
  // Unlock audio in the click/key event before model loading starts.
  try {
    if ('AudioContext' in window) { audio ??= new AudioContext(); void audio.resume().catch(() => {}); }
  } catch { /* Visual cues remain available without audio. */ }
  try {
    for (const mode of TRACKER_MODES) {
      message.textContent = `Preparing ${mode}… Countdown starts when all models are ready.`;
      await loadTracker(mode);
    }
    if (stopped) return;
    if ('wakeLock' in navigator) {
      try { wakeLock = await navigator.wakeLock.request('screen'); } catch { /* Optional. */ }
    }
    benchmark = new BenchmarkSession(performance.now());
    setActive(trackers.get('hands-full')!);
    cue.hidden = false;
    message.textContent = '';
    speak('Benchmark starts in eight seconds. Walk back. Both players use both hands.');
  } catch (error) {
    message.textContent = `Benchmark could not start: ${errorText(error)}`;
    startButton.disabled = false;
  } finally { preparing = false; }
}

function updateBenchmark(nowMs: number): void {
  const run = benchmark;
  if (!run) return;
  if (run.advance(nowMs)) {
    if (run.stage === 'done') {
      benchmark = undefined;
      void finishBenchmark(run);
      return;
    }
    setActive(trackers.get(run.mode)!);
    if (run.stage === 'ready') speak(`${run.mode}. ${run.phase.instruction}`);
    if (run.stage === 'recording') beep();
  }
  cueMode.textContent = `${run.mode} · ${active?.delegate ?? 'loading'}`;
  cueStage.textContent = run.stage === 'countdown' ? 'WALK BACK · BOTH PLAYERS' : run.stage === 'ready' ? 'GET READY' : 'RECORDING';
  cueInstruction.textContent = run.stage === 'countdown' ? '2 to 2.5 m from camera' : `${run.phase.emoji} ${run.phase.instruction}`;
  cueNumber.textContent = String(run.secondsRemaining(nowMs));
  progress.value = run.progress(nowMs);
}

async function finishBenchmark(run: BenchmarkSession): Promise<void> {
  cue.hidden = true;
  startButton.disabled = false;
  if (wakeLock) { void wakeLock.release().catch(() => {}); wakeLock = undefined; }
  speak('Benchmark complete. Results are ready.');
  const result: BenchmarkResult = {
    schemaVersion: 1, timestamp: new Date().toISOString(), userAgent: navigator.userAgent,
    camera: cameraInfo,
    delegates: Object.fromEntries(TRACKER_MODES.map((mode) => [mode, trackers.get(mode)!.delegate])) as BenchmarkResult['delegates'],
    thresholds: TRACKING_THRESHOLDS, phases: run.results,
  };
  const json = JSON.stringify(result, null, 2);
  lastJson = json; copyButton.disabled = false;
  let storageError = '';
  try { localStorage.setItem(STORAGE_KEY, json); }
  catch (error) { storageError = ` Local storage failed: ${errorText(error)}. Use Copy JSON.`; }
  renderResults(result, resultsHost);
  resultsHost.hidden = false; stage.hidden = true; backButton.hidden = false;
  saveStatus.textContent = `Saving results…${storageError}`;
  try {
    const response = await fetch('/__tracking-results', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    const saved: { path: string } = await response.json();
    if (typeof saved.path !== 'string') throw new Error('The server did not return a file path.');
    saveStatus.textContent = `Saved: ${saved.path}${storageError}`;
  } catch (error) {
    saveStatus.textContent = `File save failed: ${errorText(error)}. Use Copy JSON. ${storageError || 'The last result is also stored in this browser.'}`;
  }
}

// Hand modes have 21 landmarks; pose mode exposes wrist, pinky, index, thumb.
const HAND_EDGES = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [5, 9, 10, 11, 12],
  [9, 13, 14, 15, 16], [13, 17, 18, 19, 20], [0, 17]];

function draw(): void {
  if (!video || stage.hidden) return;
  const width = stage.clientWidth, height = stage.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
  const imageWidth = video.videoWidth * scale, imageHeight = video.videoHeight * scale;
  const offsetX = (width - imageWidth) / 2, offsetY = (height - imageHeight) / 2;
  const px = (x: number) => offsetX + x * imageWidth;
  const py = (y: number) => offsetY + y * imageHeight;
  context.save();
  context.beginPath(); context.rect(offsetX, offsetY, imageWidth, imageHeight); context.clip();
  context.strokeStyle = '#fff9'; context.lineWidth = 3;
  context.beginPath(); context.moveTo(px(0.5), py(0)); context.lineTo(px(0.5), py(1)); context.stroke();
  latest?.players.forEach((player, index) => {
    const colour = index === 0 ? '#00ffff' : '#ff65ff';
    context.strokeStyle = colour;
    for (const hand of player.hands) {
      const landmarks = hand.landmarks;
      if (landmarks) {
        context.lineWidth = 1.5;
        for (const chain of landmarks.length === 21 ? HAND_EDGES : [[0, 1], [0, 2], [0, 3], [1, 2]]) {
          context.beginPath();
          chain.forEach((id, step) => {
            const point = landmarks[id];
            if (point) step ? context.lineTo(px(point.x), py(point.y)) : context.moveTo(px(point.x), py(point.y));
          });
          context.stroke();
        }
      }
      context.fillStyle = colour;
      context.beginPath(); context.arc(px(hand.x), py(hand.y), 17, 0, Math.PI * 2); context.fill();
      context.strokeStyle = '#000'; context.lineWidth = 4; context.stroke(); context.strokeStyle = colour;
      context.font = `bold ${Math.max(32, Math.min(52, width / 28))}px system-ui`;
      const label = hand.gesture;
      const labelWidth = context.measureText(label).width;
      const x = Math.max(offsetX + 5, Math.min(px(hand.x) + 25, offsetX + imageWidth - labelWidth - 8));
      const y = Math.max(offsetY + 42, Math.min(py(hand.y) - 16, offsetY + imageHeight - 10));
      context.strokeStyle = '#000'; context.lineWidth = 7; context.strokeText(label, x, y);
      context.fillText(label, x, y); context.strokeStyle = colour;
    }
  });
  context.restore();
}

function updateHud(nowMs: number): void {
  if (!video || !active || nowMs - lastHudMs < 250) return;
  lastHudMs = nowMs;
  recent = recent.filter((frame) => frame.timeMs >= nowMs - 2000);
  const elapsed = recent.length > 1 ? recent.at(-1)!.timeMs - recent[0].timeMs : 0;
  const fps = elapsed ? (recent.length - 1) * 1000 / elapsed : 0;
  const inference = mean(recent.map((frame) => frame.inferenceMs));
  hud.textContent = `${active.mode} · ${active.delegate} · ${video.videoWidth}×${video.videoHeight} · ${fps.toFixed(1)} FPS · ${inference?.toFixed(1) ?? '—'} ms · P0: ${latest?.players[0].hands.length ?? 0} · P1: ${latest?.players[1].hands.length ?? 0}`;
}

function processFrame(nowMs: number): void {
  if (!active || !video || video.readyState < 2 || stopped) return;
  updateBenchmark(nowMs);
  try {
    const tracker = active;
    latest = tracker.process(video, nowMs);
    recent.push(latest);
    benchmark?.record(latest, tracker.mode);
  } catch (error) {
    message.textContent = `Tracking stopped: ${errorText(error)}. Reload to retry.`;
    cue.hidden = true;
    benchmark = undefined;
    startButton.disabled = true;
    active = undefined;
    if (wakeLock) { void wakeLock.release().catch(() => {}); wakeLock = undefined; }
    console.error('Tracker inference failed', error);
  }
}

function scheduleFrames(): void {
  if (!video || stopped) return;
  if (typeof video.requestVideoFrameCallback === 'function') {
    videoCallbackId = video.requestVideoFrameCallback((_now, metadata) => {
      if (metadata.presentedFrames !== lastPresentedFrame) {
        lastPresentedFrame = metadata.presentedFrames;
        processFrame(performance.now());
      }
      scheduleFrames();
    });
  } else {
    fallbackRafId = requestAnimationFrame(() => {
      if (video && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        processFrame(performance.now());
      }
      scheduleFrames();
    });
  }
}

function animate(nowMs: number): void {
  if (stopped) return;
  updateBenchmark(nowMs); updateHud(nowMs); draw();
  rafId = requestAnimationFrame(animate);
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (error) { message.textContent = `Fullscreen failed: ${errorText(error)}`; }
}
startButton.addEventListener('click', () => void startBenchmark());
element('fullscreen').addEventListener('click', () => void toggleFullscreen());
backButton.addEventListener('click', () => { resultsHost.hidden = true; stage.hidden = false; backButton.hidden = true; });
copyButton.addEventListener('click', async () => {
  if (!lastJson) return;
  try { await navigator.clipboard.writeText(lastJson); saveStatus.textContent = 'JSON copied.'; }
  catch (error) { saveStatus.textContent = `Copy failed: ${errorText(error)}. The last result remains available in this browser.`; }
});
window.addEventListener('keydown', (event) => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  const mode = ({ '1': 'hands-full', '2': 'hands-split', '3': 'pose' } as const)[event.key as '1' | '2' | '3'];
  if (mode) { event.preventDefault(); void switchMode(mode); }
  if (event.key.toLowerCase() === 'b') { event.preventDefault(); void startBenchmark(); }
  if (event.key.toLowerCase() === 'f') { event.preventDefault(); void toggleFullscreen(); }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && benchmark) {
    benchmark = undefined; cue.hidden = true; startButton.disabled = false;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    message.textContent = 'Benchmark cancelled because the page was hidden. Press B to restart.';
    if (wakeLock) { void wakeLock.release().catch(() => {}); wakeLock = undefined; }
  }
});
window.addEventListener('pagehide', () => {
  stopped = true;
  cancelAnimationFrame(rafId); cancelAnimationFrame(fallbackRafId);
  if (video && videoCallbackId && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(videoCallbackId);
  if (video?.srcObject instanceof MediaStream) video.srcObject.getTracks().forEach((track) => track.stop());
  trackers.forEach((tracker) => tracker.dispose());
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  void audio?.close().catch(() => {});
  if (wakeLock) void wakeLock.release().catch(() => {});
});

async function boot(): Promise<void> {
  try {
    video = await startCamera();
    if (stopped) { (video.srcObject as MediaStream).getTracks().forEach((track) => track.stop()); return; }
    video.id = 'camera'; video.setAttribute('aria-label', 'Mirrored camera'); stage.prepend(video);
    const settings = (video.srcObject as MediaStream).getVideoTracks()[0].getSettings();
    cameraInfo = { width: video.videoWidth, height: video.videoHeight, frameRate: settings.frameRate ?? null };
    await switchMode('hands-full');
    scheduleFrames(); rafId = requestAnimationFrame(animate);
  } catch (error) { message.textContent = `Camera failed: ${errorText(error)}. Check camera permission, then reload.`; }
}
void boot();
