// Browser metadata probe. It is intentionally dependency-free: the browser
// already decodes the formats it can play, and ffmpeg.wasm handles the rest with
// a log-based fallback in `engine/ffmpeg.ts`.
import { probeImage } from '@/engine/image';
import type { MediaKind, MediaProbe } from '@/lib/types';

const PROBE_TIMEOUT_MS = 8000;

/** probeMedia returns duration and dimensions without uploading anything. */
export async function probeMedia(file: File, kind: MediaKind): Promise<MediaProbe> {
  if (kind === 'image') {
    try {
      const size = await probeImage(file);
      return { duration: 0, width: size.width, height: size.height, hasAudio: false };
    } catch {
      return { duration: 0, hasAudio: false };
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<MediaProbe>((resolve) => {
      const element = document.createElement(kind === 'video' ? 'video' : 'audio');
      element.preload = 'metadata';
      if (kind === 'video') {
        (element as HTMLVideoElement).muted = true;
      }

      let settled = false;
      const finish = (probe: MediaProbe) => {
        if (settled) return;
        settled = true;
        element.removeAttribute('src');
        element.load();
        resolve(probe);
      };
      const timer = window.setTimeout(
        () => finish({ duration: 0, hasAudio: kind === 'audio' }),
        PROBE_TIMEOUT_MS,
      );
      element.addEventListener(
        'loadedmetadata',
        () => {
          window.clearTimeout(timer);
          const video = element as HTMLVideoElement;
          finish({
            duration: Number.isFinite(element.duration) ? element.duration : 0,
            width: kind === 'video' ? video.videoWidth || undefined : undefined,
            height: kind === 'video' ? video.videoHeight || undefined : undefined,
            hasAudio: true,
          });
        },
        { once: true },
      );
      element.addEventListener(
        'error',
        () => {
          window.clearTimeout(timer);
          finish({ duration: 0, hasAudio: kind === 'audio' });
        },
        { once: true },
      );
      element.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** canPreviewImage reports whether a thumbnail is worth rendering. */
export function canPreviewImage(kind: MediaKind, file: File): boolean {
  if (kind !== 'image') return false;
  return file.type !== 'image/svg+xml' && file.size < 40 * 1024 * 1024;
}
