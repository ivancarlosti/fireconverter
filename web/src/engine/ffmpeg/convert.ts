// High-level local conversion: engine load, probe, two-pass encode, size
// verification and cleanup. The store only sees a Blob and a stage callback.
import { runArgs, reducePlan } from '@/engine/ffmpeg/run';
import { buildLocalArgs } from '@/engine/ffmpeg/args';
import {
  loadEngine,
  probeWithFFmpeg,
  removeFile,
  withEngineLock,
} from '@/engine/ffmpeg/core';
import { ConversionError } from '@/lib/errors';
import { extensionOf } from '@/lib/formats';
import { buildPlan } from '@/lib/plan';
import type { MediaProbe, Plan, QualityPreset } from '@/lib/types';

export interface LocalConvertOptions {
  kind: 'audio' | 'video';
  format: string;
  targetBytes?: number;
  plan?: Plan;
  probe: MediaProbe;
  videoPreset: QualityPreset;
  audioKbps: number;
  scale: string;
  fps: number;
}

export interface LocalConvertResult {
  blob: Blob;
  width?: number;
  height?: number;
  duration: number;
  retried: boolean;
}

/** convertLocal runs the whole browser conversion behind the engine lock. */
export function convertLocal(
  file: File,
  options: LocalConvertOptions,
  onProgress: (percent: number, stage: string) => void,
  onEngine: (percent: number) => void,
): Promise<LocalConvertResult> {
  return withEngineLock(async () => {
    const ffmpeg = await loadEngine((stage) => onEngine(stage.percent));
    const id = crypto.randomUUID().slice(0, 8);
    const input = `input-${id}.${extensionOf(file.name) || (options.kind === 'audio' ? 'bin' : 'mp4')}`;
    const output = `output-${id}.${options.format}`;
    const passlog = `pass-${id}`;

    await ffmpeg.writeFile(input, new Uint8Array(await file.arrayBuffer()));
    try {
      const actual = await probeWithFFmpeg(ffmpeg, input);
      const duration = actual.duration || options.probe.duration;
      const width = actual.width ?? options.probe.width;
      const height = actual.height ?? options.probe.height;
      const hasAudio = actual.duration > 0 ? actual.hasAudio : options.probe.hasAudio;

      let plan = options.plan;
      if (options.targetBytes) {
        if (!duration) throw new ConversionError('duration_unknown');
        plan = buildPlan(
          options.kind,
          options.format,
          { duration, width, height, hasAudio },
          options.targetBytes,
          options.audioKbps,
          options.scale,
          options.fps,
        );
      }

      let retried = false;
      let blob: Blob | null = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const args = buildLocalArgs({
          kind: options.kind,
          input,
          output,
          format: options.format,
          targetBytes: options.targetBytes,
          plan,
          probe: { duration, width, height, hasAudio },
          videoPreset: options.videoPreset,
          audioKbps: options.audioKbps,
          scale: options.scale,
          fps: options.fps,
          passlog,
        });
        blob = await runArgs(
          ffmpeg,
          args,
          duration,
          onProgress,
          input,
          output,
          options.kind,
          options.format,
        );
        if (!options.targetBytes || blob.size <= options.targetBytes) break;
        if (attempt === 1) throw new ConversionError('target_missed');
        retried = true;
        plan = reducePlan(plan);
      }
      if (!blob) throw new ConversionError('encode_failed');
      onProgress(100, 'done');
      return {
        blob,
        width: options.kind === 'video' ? width : undefined,
        height: options.kind === 'video' ? height : undefined,
        duration,
        retried,
      };
    } finally {
      await removeFile(ffmpeg, input);
      await removeFile(ffmpeg, output);
      await removeFile(ffmpeg, `${passlog}-0.log`);
      await removeFile(ffmpeg, `${passlog}-0.log.mbtree`);
    }
  });
}

/** probeLocalMedia loads the engine for a format the browser cannot probe. */
export function probeLocalMedia(
  file: File,
): Promise<{ duration: number; width?: number; height?: number; hasAudio: boolean }> {
  return withEngineLock(async () => {
    const ffmpeg = await loadEngine(() => {});
    const name = `probe-${crypto.randomUUID().slice(0, 8)}.${extensionOf(file.name) || 'bin'}`;
    await ffmpeg.writeFile(name, new Uint8Array(await file.arrayBuffer()));
    try {
      return await probeWithFFmpeg(ffmpeg, name);
    } finally {
      await removeFile(ffmpeg, name);
    }
  });
}
