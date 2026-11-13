import { find, isHandClick } from './dom';
import { mainVideo, sizeText, VIDEO_NAMES } from './recording';
import type { RoundVideos } from './recording';
import { tailShare } from './roundRecordings';
import type { RecordingsView } from './roundRecordings';

/**
 * The recording of the round on the results screen: the place of its preview, then its
 * download links and the rule that the game keeps no videos.
 */
export const RECORDINGS_HTML = `
  <div class="recordings" hidden>
    <div class="preview-slot"></div>
    <div class="recording-files">
      <div class="recording-links"></div>
      <p>Download now. The videos are deleted when you leave this screen.</p>
    </div>
  </div>`;

type WaitView = Extract<RecordingsView, { stage: 'tail' | 'finishing' }>;

/** What the placeholder says while the players wait for the videos. */
const WAIT_TEXT: Record<WaitView['stage'], string> = {
  tail: 'Still recording…',
  finishing: 'Finishing the video…',
};

/** Hears the round to play in the video player, and whether a pointing hand chose it. */
export type WatchHandler = (round: RoundVideos, byHand: boolean) => void;

/**
 * Shows the round's recording in `block`. While the videos are made, a placeholder holds the
 * place of the preview. Once they are ready, the preview shows, with the download links.
 */
export function showRecordings(block: HTMLElement, view: RecordingsView, onWatch: WatchHandler): void {
  block.hidden = view.stage === 'none';
  // The stylesheet keeps the links and the rule unseen until the videos are ready.
  block.dataset.stage = view.stage;
  const slot = find(block, '.preview-slot');
  const videos = view.stage === 'ready' ? view.videos : undefined;
  if (view.stage === 'tail' || view.stage === 'finishing') showWait(slot, view);
  else showPreview(slot, videos, onWatch);
  showLinks(find(block, '.recording-links'), videos);
}

/**
 * Stops the preview of a round inside `root` and removes it. A hidden panel keeps its content,
 * and a looping video in it would go on decoding during the next round.
 */
export function removePreview(root: ParentNode): void {
  for (const slot of root.querySelectorAll<HTMLElement>('.preview-slot')) emptySlot(slot);
}

/**
 * Empties the place of the preview. Its video is unloaded first: a video that is only taken
 * off the page plays on until it is collected, and holds on to its file until then.
 */
function emptySlot(slot: HTMLElement): void {
  for (const video of slot.querySelectorAll<HTMLVideoElement>('.preview video')) {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
  slot.replaceChildren();
}

/**
 * The placeholder of the preview while the videos are made: the same box, with what the game
 * does and a bar. During the tail the bar fills over the tail's length. While the videos are
 * finished, that time is unknown: the bar is full and pulses. The stylesheet moves the bar.
 */
function showWait(slot: HTMLElement, view: WaitView): void {
  let wait = slot.querySelector<HTMLElement>('.recording-wait');
  if (!wait) {
    wait = document.createElement('div');
    wait.className = 'recording-wait';
    wait.innerHTML = '<p role="status"></p><div class="wait-bar"><span></span></div>';
    emptySlot(slot);
    slot.append(wait);
  }
  // The bar runs on by itself. New times would start its fill again.
  if (wait.dataset.stage === view.stage) return;
  wait.dataset.stage = view.stage;
  find(wait, 'p').textContent = WAIT_TEXT[view.stage];
  if (view.stage === 'tail') {
    wait.style.setProperty('--tail-sec', String(view.tailSec));
    wait.style.setProperty('--tail-passed-sec', String(view.passedSec));
    wait.style.setProperty('--tail-share', String(tailShare(view.passedSec, view.tailSec)));
  }
}

/** The small silent video of a round. A click, or a fist, plays the round in the video player. */
function showPreview(slot: HTMLElement, round: RoundVideos | undefined, onWatch: WatchHandler): void {
  const video = round && mainVideo(round);
  // Keep a preview that already plays this video: a new element would start it again.
  if (video && slot.querySelector('video')?.src === video.url) return;
  emptySlot(slot);
  if (!round || !video) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'preview';
  button.dataset.hand = 'watch-preview';
  button.setAttribute('aria-label', 'Watch the round');
  const picture = document.createElement('video');
  picture.muted = true;
  picture.loop = true;
  picture.autoplay = true;
  picture.playsInline = true;
  picture.src = video.url;
  const label = document.createElement('span');
  label.textContent = '▶ Watch the round';
  button.append(picture, label);
  button.addEventListener('click', (event) => onWatch(round, isHandClick(event)));
  slot.append(button);
}

/** One row with a download link for each video of the round. Empty while there are none. */
function showLinks(row: HTMLElement, round: RoundVideos | undefined): void {
  const links = (round?.videos ?? []).map((video) => {
    const link = document.createElement('a');
    link.href = video.url;
    link.download = video.fileName;
    link.textContent = `⬇ ${VIDEO_NAMES[video.kind]} · ${sizeText(video.sizeBytes)}`;
    return link;
  });
  row.replaceChildren(...links);
}
