// Codec tables and small argument helpers shared by the local builders.
import type { QualityPreset } from '@/lib/types';

export interface Codecs {
  video?: string;
  audio?: string;
  muxer?: string;
}

export const VIDEO_CODECS: Record<string, Codecs> = {
  mp4: { video: 'libx264', audio: 'aac' },
  mov: { video: 'libx264', audio: 'aac' },
  mkv: { video: 'libx264', audio: 'aac' },
  webm: { video: 'libvpx-vp9', audio: 'libopus' },
  gif: { video: 'gif' },
  mp3: { audio: 'libmp3lame' },
};

export const AUDIO_CODECS: Record<string, Codecs> = {
  mp3: { audio: 'libmp3lame' },
  m4a: { audio: 'aac' },
  aac: { audio: 'aac', muxer: 'adts' },
  ogg: { audio: 'libvorbis' },
  opus: { audio: 'libopus' },
  flac: { audio: 'flac' },
  wav: { audio: 'pcm_s16le' },
};

export function videoRateArgs(encoder: string, kbps: number): string[] {
  if (encoder === 'libx264') {
    return [
      '-preset', 'medium',
      '-b:v', `${kbps}k`,
      '-maxrate', `${Math.round(kbps * 1.45)}k`,
      '-bufsize', `${kbps * 2}k`,
      '-pix_fmt', 'yuv420p',
    ];
  }
  return ['-b:v', `${kbps}k`, '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2'];
}

export function crfFor(preset: QualityPreset, encoder: string): number {
  const base = preset === 'high' ? 18 : preset === 'small' ? 28 : 23;
  if (encoder !== 'libvpx-vp9') return base;
  return Math.min(63, base + 7);
}

export function containerArgs(format: string): string[] {
  if (format === 'mp4' || format === 'mov' || format === 'm4a') {
    return ['-movflags', '+faststart'];
  }
  return [];
}

/** scaleFilter turns `1280x720` into an aspect-preserving even scale. */
export function scaleFilter(scale: string): string {
  const match = /^(\d{2,5})x(\d{2,5})$/i.exec(scale.trim());
  if (!match) return '';
  return `scale=w=${match[1]}:h=${match[2]}:force_original_aspect_ratio=decrease:force_divisible_by=2`;
}
