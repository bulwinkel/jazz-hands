/** Request the front camera and resolve only when playback has a decoded frame. */
export async function startCamera(): Promise<HTMLVideoElement> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 },
      frameRate: { ideal: 30 } },
  });
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
          error ? reject(error) : resolve();
        }
        function loaded() { finish(); }
        function failed() { finish(new Error('Cannot decode the camera stream.')); }
        video.addEventListener('loadeddata', loaded, { once: true });
        video.addEventListener('error', failed, { once: true });
      });
    }
    return video;
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
}
