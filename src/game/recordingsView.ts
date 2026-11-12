import { find, isHandClick } from './dom';
import { sizeText } from './recording';
import type { RoundVideos, VideoKind } from './recording';

/** The list of recorded rounds, with a download link for each video. Menu and results both have it. */
export const RECORDINGS_HTML =
  '<div class="recordings" hidden><div class="preview-slot"></div><p role="status"></p><ul></ul></div>';

const VIDEO_NAMES: Record<VideoKind, string> = { game: 'Game view', camera: 'Camera only' };

/** What the list shows. */
export interface RecordingsList {
  /** The recorded rounds, newest first. */
  rounds: readonly RoundVideos[];
  /** A line above the list, for a recording that is not finished yet. */
  status: string;
  /** The round to show as a small silent video above the list: the round whose results are on screen. */
  preview?: RoundVideos;
}

/** Hears the round to play in the video player, and whether a pointing hand chose it. */
export type WatchHandler = (round: RoundVideos, byHand: boolean) => void;

/**
 * Shows the recorded rounds in `block`, newest first. Each has a button that plays it in the
 * video player and a link that downloads each video.
 */
export function showRecordings(block: HTMLElement, list: RecordingsList, onWatch: WatchHandler): void {
  const { rounds, status, preview } = list;
  block.hidden = rounds.length === 0 && !status;
  find(block, 'p').textContent = status;
  showPreview(find(block, '.preview-slot'), preview, onWatch);

  const rows = rounds.map((round) => {
    const row = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = round.label;
    const watch = document.createElement('button');
    watch.type = 'button';
    // The id stays with the round when the list changes, so a fist held on Watch keeps its round.
    watch.dataset.hand = `watch-${round.id}`;
    watch.textContent = '▶ Watch';
    watch.addEventListener('click', (event) => onWatch(round, isHandClick(event)));
    row.append(label, watch);
    for (const video of round.videos) {
      const link = document.createElement('a');
      link.href = video.url;
      link.download = video.fileName;
      link.textContent = `⬇ ${VIDEO_NAMES[video.kind]} · ${sizeText(video.sizeBytes)}`;
      row.append(link);
    }
    return row;
  });
  find(block, 'ul').replaceChildren(...rows);
}

/**
 * Stops the preview of a round inside `root` and removes it. A hidden panel keeps its content,
 * and a looping video in it would go on decoding during the next round.
 */
export function removePreview(root: ParentNode): void {
  for (const video of root.querySelectorAll<HTMLVideoElement>('.preview video')) {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
  for (const slot of root.querySelectorAll('.preview-slot')) slot.replaceChildren();
}

/** The small silent video of a round. A click, or a fist, plays the round in the video player. */
function showPreview(slot: HTMLElement, round: RoundVideos | undefined, onWatch: WatchHandler): void {
  const video = round?.videos.find((candidate) => candidate.kind === 'game') ?? round?.videos[0];
  if (!round || !video) {
    slot.replaceChildren();
    return;
  }
  // Keep a preview that already plays this video: a new element would start it again.
  if (slot.querySelector('video')?.src === video.url) return;

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
  slot.replaceChildren(button);
}
