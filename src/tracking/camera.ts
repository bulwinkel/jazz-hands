/** The error of a camera start that was cancelled. */
const cancelled = (): DOMException => new DOMException('The camera was closed while it started.', 'AbortError');

/**
 * Request the front camera and resolve only when playback has a decoded frame.
 * An abort of `signal` stops the camera at once, also while it still starts: the first frame
 * can take a while, and the camera light must not stay on for a start nobody wants.
 */
export async function startCamera(signal?: AbortSignal): Promise<HTMLVideoElement> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 },
      frameRate: { ideal: 30 } },
  });
  const stop = (): void => stream.getTracks().forEach((track) => track.stop());
  if (signal?.aborted) {
    stop();
    throw cancelled();
  }
  signal?.addEventListener('abort', stop, { once: true });
  const video = document.createElement('video');
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    await video.play();
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => finish(new Error('Camera frame timed out.')), 15_000);
        function finish(error?: Error) {
          clearTimeout(timer);
          video.removeEventListener('loadeddata', loaded);
          video.removeEventListener('error', failed);
          signal?.removeEventListener('abort', aborted);
          error ? reject(error) : resolve();
        }
        function loaded() { finish(); }
        function failed() { finish(new Error('Cannot decode the camera stream.')); }
        function aborted() { finish(cancelled()); }
        video.addEventListener('loadeddata', loaded, { once: true });
        video.addEventListener('error', failed, { once: true });
        signal?.addEventListener('abort', aborted, { once: true });
      });
    }
    if (signal?.aborted) throw cancelled();
    return video;
  } catch (error) {
    stop();
    throw error;
  }
}
