// Format catalogue of the SPA.
//
// The server exposes its own catalogue at /api/formats, but the browser engines
// cover a different set (Canvas cannot emit TIFF, for example), so the UI keeps
// one explicit table per category. `engine` decides which list a card shows.
import type { Engine, FormatOption, MediaKind } from '@/lib/types';

/** IMAGE_EXTENSIONS are the image inputs the browser can decode. */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'bmp', 'svg', 'ico'];

/** AUDIO_EXTENSIONS are the audio inputs ffmpeg.wasm handles. */
export const AUDIO_EXTENSIONS = [
  'mp3', 'wav', 'flac', 'ogg', 'oga', 'opus', 'aac', 'm4a', 'm4b', 'alac', 'wma', 'aiff', 'aif', 'ac3', 'mp2',
];

/** VIDEO_EXTENSIONS are the video inputs ffmpeg.wasm handles. */
export const VIDEO_EXTENSIONS = [
  'mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v', 'mts', 'ts', 'm2ts', 'flv', 'f4v', 'wmv', '3gp', '3g2', 'ogv', 'mpg', 'mpeg', 'vob',
];

/** IMAGE_FORMATS are the Canvas outputs. AVIF is feature-detected at runtime. */
export const IMAGE_FORMATS: FormatOption[] = [
  { value: 'webp', label: 'WebP' },
  { value: 'jpg', label: 'JPEG' },
  { value: 'png', label: 'PNG' },
  { value: 'avif', label: 'AVIF' },
];

/** AUDIO_FORMATS are the local audio outputs. */
export const AUDIO_FORMATS: FormatOption[] = [
  { value: 'mp3', label: 'MP3' },
  { value: 'm4a', label: 'M4A (AAC)' },
  { value: 'aac', label: 'AAC' },
  { value: 'ogg', label: 'OGG (Vorbis)' },
  { value: 'opus', label: 'Opus' },
  { value: 'flac', label: 'FLAC' },
  { value: 'wav', label: 'WAV' },
];

/** VIDEO_FORMATS are the outputs shared by the local and server engines. */
export const VIDEO_FORMATS: FormatOption[] = [
  { value: 'mp4', label: 'MP4 (H.264)' },
  { value: 'webm', label: 'WebM (VP9)' },
  { value: 'mkv', label: 'MKV (H.264)' },
  { value: 'mov', label: 'MOV (H.264)' },
  { value: 'gif', label: 'GIF' },
  { value: 'mp3', label: 'MP3 (audio only)' },
];

/** LOSSLESS_AUDIO cannot hit a byte target. */
const LOSSLESS_AUDIO = new Set(['wav', 'flac']);

/** extensionOf returns the lower-case extension without the dot. */
export function extensionOf(name: string): string {
  const index = name.lastIndexOf('.');
  if (index < 0) return '';
  return name.slice(index + 1).toLowerCase();
}

/** kindOf classifies a file by extension, then by MIME family. */
export function kindOf(file: File): MediaKind | null {
  const ext = extensionOf(file.name);
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (AUDIO_EXTENSIONS.includes(ext)) return 'audio';
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  return null;
}

/** acceptAttribute is the `accept` list of the file input. */
export function acceptAttribute(): string {
  const extensions = [...IMAGE_EXTENSIONS, ...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS];
  return extensions.map((ext) => `.${ext}`).join(',');
}

/** formatOptions returns the catalog of a category (AVIF filtered by caller). */
export function formatOptions(kind: MediaKind, engine: Engine = 'local'): FormatOption[] {
  if (kind === 'image') return IMAGE_FORMATS;
  if (kind === 'audio') return AUDIO_FORMATS;
  return VIDEO_FORMATS.filter((option) => engine === 'local' || option.value !== 'gif');
}

/** defaultFormat is the starting output of a category. */
export function defaultFormat(kind: MediaKind): string {
  if (kind === 'image') return 'webp';
  if (kind === 'audio') return 'mp3';
  return 'mp4';
}

/** isLossless reports whether an audio output ignores a target bitrate. */
export function isLossless(format: string): boolean {
  return LOSSLESS_AUDIO.has(format);
}

/** supportsTarget reports whether target-size mode makes sense. */
export function supportsTarget(kind: MediaKind, format: string): boolean {
  if (kind === 'image') return ['jpg', 'png', 'webp', 'avif'].includes(format);
  if (kind === 'audio') return !LOSSLESS_AUDIO.has(format);
  return ['mp4', 'webm', 'mkv', 'mov'].includes(format);
}

/** mimeFor maps an output to the Blob type. */
export function mimeFor(kind: MediaKind, format: string): string {
  if (kind === 'image') {
    return {
      jpg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      avif: 'image/avif',
    }[format] ?? 'application/octet-stream';
  }
  if (kind === 'audio') {
    return {
      mp3: 'audio/mpeg',
      m4a: 'audio/mp4',
      aac: 'audio/aac',
      ogg: 'audio/ogg',
      opus: 'audio/ogg',
      flac: 'audio/flac',
      wav: 'audio/wav',
    }[format] ?? 'application/octet-stream';
  }
  return {
    mp4: 'video/mp4',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    mov: 'video/quicktime',
    gif: 'image/gif',
    mp3: 'audio/mpeg',
  }[format] ?? 'application/octet-stream';
}

/** outputName is `base-converted.ext`, so a download never overwrites the source. */
export function outputName(name: string, format: string): string {
  const index = name.lastIndexOf('.');
  const base = index > 0 ? name.slice(0, index) : name;
  return `${base}-converted.${format}`;
}
