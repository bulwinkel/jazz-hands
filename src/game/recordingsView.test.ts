import { describe, expect, it, vi } from 'vitest';
import { removePreview, showRecordings } from './recordingsView';

/**
 * The tests run without a page. These stand-ins have just what the preview's unloading uses:
 * a slot that holds one preview with its looping video, or nothing.
 */
class FakeVideo {
  src = 'blob:video-1';
  paused = false;
  loads = 0;
  pause(): void {
    this.paused = true;
  }
  removeAttribute(name: string): void {
    if (name === 'src') this.src = '';
  }
  load(): void {
    this.loads++;
  }
}

class FakeSlot {
  readonly video = new FakeVideo();
  children: unknown[] = [this.video];
  querySelector(selector: string): FakeVideo | null {
    return selector === 'video' && this.children.length > 0 ? this.video : null;
  }
  querySelectorAll(selector: string): FakeVideo[] {
    return selector === '.preview video' && this.children.length > 0 ? [this.video] : [];
  }
  replaceChildren(...nodes: unknown[]): void {
    this.children = nodes;
  }
}

/** The recordings block of the results, with a preview on show. */
function blockWithPreview() {
  const slot = new FakeSlot();
  const links = { replaceChildren: vi.fn() };
  const parts: Record<string, unknown> = { '.preview-slot': slot, '.recording-links': links };
  const block = { hidden: false, dataset: {}, querySelector: (selector: string) => parts[selector] ?? null };
  return { block: block as unknown as HTMLElement, slot };
}

const expectUnloaded = (video: FakeVideo): void => {
  expect(video.paused).toBe(true);
  expect(video.src).toBe('');
  expect(video.loads).toBe(1);
};

describe('the preview of a round', () => {
  it('is unloaded, not only removed, when the videos of its round go', () => {
    // The results close: the videos are freed, and the view has no videos any more.
    const { block, slot } = blockWithPreview();
    showRecordings(block, { stage: 'none' }, vi.fn());
    expectUnloaded(slot.video);
    expect(slot.children).toEqual([]);
    expect(block.hidden).toBe(true);
  });

  it('is unloaded when its panel closes', () => {
    const slot = new FakeSlot();
    const panel = { querySelectorAll: (selector: string) => (selector === '.preview-slot' ? [slot] : []) };
    removePreview(panel as unknown as ParentNode);
    expectUnloaded(slot.video);
    expect(slot.children).toEqual([]);
  });
});
