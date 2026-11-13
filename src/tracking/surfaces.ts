import type { CameraPicture } from './types';

/**
 * The trackers run on the page and in the tracking worker. The worker has no document, so
 * it has no HTML canvas and no video element. These helpers give each place what it has.
 */

/** A canvas: an HTML canvas on the page, an OffscreenCanvas in the worker. */
export type Surface = HTMLCanvasElement | OffscreenCanvas;

/** What the trackers draw with. The 2D context of either kind of canvas has it. */
export type DrawingContext = CanvasDrawImage & CanvasRect;

/** True on the page. False in the tracking worker. */
export function hasDocument(): boolean {
  return typeof document !== 'undefined';
}

/** A new canvas of the kind this place can make. */
export function newSurface(): Surface {
  return hasDocument() ? document.createElement('canvas') : new OffscreenCanvas(1, 1);
}

/** The 2D context of a canvas of either kind. Null when the browser cannot make one. */
export function drawingContext(surface: Surface): DrawingContext | null {
  return isOffscreen(surface) ? surface.getContext('2d') : surface.getContext('2d');
}

function isOffscreen(surface: Surface): surface is OffscreenCanvas {
  return typeof OffscreenCanvas !== 'undefined' && surface instanceof OffscreenCanvas;
}

/** The size of a camera picture in pixels: a video on the page, a VideoFrame in the worker. */
export function pictureSize(picture: CameraPicture): { width: number; height: number } {
  return 'videoWidth' in picture
    ? { width: picture.videoWidth, height: picture.videoHeight }
    : { width: picture.displayWidth, height: picture.displayHeight };
}
