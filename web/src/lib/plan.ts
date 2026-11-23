// Target-size planner for the browser engines.
//
// It is the same arithmetic as internal/convert/plan.go: a 3% container reserve,
// a 50 kbps video floor, an 8..320 kbps audio range and the audio track reserved
// before the video track. Keeping the two implementations aligned means a plan
// does not change when the user switches between the local and server engines.
import { ConversionError } from '@/lib/errors';
import { supportsTarget } from '@/lib/formats';
import type { MediaKind, MediaProbe, Plan } from '@/lib/types';

const CONTAINER_OVERHEAD = 0.97;
const MIN_VIDEO_KBPS = 50;
const MIN_AUDIO_KBPS = 8;
const MAX_AUDIO_KBPS = 320;

/** targetBytesFromMB converts the decimal MB the UI shows into bytes. */
export function targetBytesFromMB(value: number): number {
  return Math.round(value * 1000 * 1000);
}

/** buildPlan throws ConversionError when the target cannot be reached. */
export function buildPlan(
  kind: MediaKind,
  format: string,
  probe: MediaProbe,
  targetBytes: number,
  audioKbps: number,
  scale: string,
  fps: number,
): Plan {
  if (targetBytes <= 0) {
    throw new ConversionError('target_too_small', 'the target size must be positive');
  }
  if (!supportsTarget(kind, format)) {
    throw new ConversionError('target_unsupported');
  }
  if (!probe.duration || probe.duration <= 0) {
    throw new ConversionError('duration_unknown');
  }

  const duration = probe.duration;
  const totalKbps = (targetBytes * 8) / duration / 1000 * CONTAINER_OVERHEAD;
  const plan: Plan = {
    target_bytes: targetBytes,
    target_mb: Math.round(targetBytes / 1_000_000 * 10) / 10,
    duration_seconds: duration,
    passes: 1,
    estimated_bytes: 0,
    scale: scale || undefined,
    fps: fps || undefined,
    warnings: [],
  };
  if (probe.width) plan.width = probe.width;
  if (probe.height) plan.height = probe.height;

  if (kind === 'audio') {
    const bitrate = Math.floor(totalKbps);
    if (bitrate < MIN_AUDIO_KBPS) {
      throw new ConversionError('target_too_small', undefined, minimumBytes('audio', 0, duration));
    }
    plan.audio_bitrate_kbps = Math.min(bitrate, MAX_AUDIO_KBPS);
    if (bitrate > MAX_AUDIO_KBPS) plan.warnings?.push('target_above_codec_max');
    plan.estimated_bytes = estimateBytes(0, plan.audio_bitrate_kbps, duration);
    return plan;
  }

  let audio = 0;
  if (probe.hasAudio) {
    audio = audioKbps > 0 ? audioKbps : 128;
    const ceiling = Math.max(32, Math.floor(totalKbps * 0.25));
    if (audio > ceiling) audio = ceiling;
    if (audio > MAX_AUDIO_KBPS) audio = MAX_AUDIO_KBPS;
    if (audio < 32) audio = 0;
  }

  const video = Math.floor(totalKbps) - audio;
  if (video < MIN_VIDEO_KBPS) {
    throw new ConversionError('target_too_small', undefined, minimumBytes('video', audio, duration));
  }
  if (video > 100_000) plan.warnings?.push('bitrate_very_high');

  plan.video_bitrate_kbps = video;
  plan.audio_bitrate_kbps = audio || undefined;
  plan.passes = 2;
  plan.estimated_bytes = estimateBytes(video, audio, duration);
  return plan;
}

/** minimumBytes is the smallest target a file can reach. */
export function minimumBytes(kind: MediaKind, audioKbps: number, duration: number): number {
  const kbps = kind === 'video' ? MIN_VIDEO_KBPS + audioKbps : MIN_AUDIO_KBPS;
  return Math.ceil((kbps * 1000) / 8 * duration / CONTAINER_OVERHEAD);
}

/** estimateBytes projects the muxed size of a bitrate pair. */
export function estimateBytes(videoKbps: number, audioKbps: number, duration: number): number {
  return Math.ceil(((videoKbps + audioKbps) * 1000) / 8 * duration / CONTAINER_OVERHEAD);
}

/** minimumTargetMB renders a minimum in MB for a message. */
export function minimumTargetMB(bytes: number): number {
  return Math.ceil((bytes / 1_000_000) * 10) / 10;
}
