// One encode pass with progress, and the verification helpers around it.
import { FFmpeg } from '@ffmpeg/ffmpeg';

import type { LocalArgs } from '@/engine/ffmpeg/args';
import { readBlob, runExec } from '@/engine/ffmpeg/core';
import { ConversionError } from '@/lib/errors';
import { mimeFor } from '@/lib/formats';
import type { MediaKind, Plan } from '@/lib/types';

/** runArgs executes the pass(es) and returns the encoded Blob. */
export async function runArgs(
  ffmpeg: FFmpeg,
  args: LocalArgs,
  duration: number,
  onProgress: (percent: number, stage: string) => void,
  inputName: string,
  outputName: string,
  kind: 'audio' | 'video',
  format: string,
): Promise<Blob> {
  const logs: string[] = [];
  let stageIndex = 0;
  const listener = ({ progress, time }: { progress: number; time: number }) => {
    const stage = args.stages[stageIndex] ?? args.stages[args.stages.length - 1];
    const ratio =
      progress > 0 && progress <= 1
        ? progress
        : duration > 0
          ? time / 1_000_000 / duration
          : 0;
    const percent = stage.from + (stage.to - stage.from) * Math.min(1, Math.max(0, ratio));
    const label = args.pass1 ? (stageIndex === 0 ? 'pass1' : 'pass2') : 'encode';
    onProgress(Math.min(99.5, percent), label);
  };
  ffmpeg.on('progress', listener);
  try {
    if (args.pass1) {
      const code = await runExec(ffmpeg, args.pass1, logs);
      if (code !== 0) throw failure(logs, inputName, outputName);
      stageIndex = 1;
    }
    const code = await runExec(ffmpeg, args.pass2, logs);
    if (code !== 0) throw failure(logs, inputName, outputName);
    return await readBlob(ffmpeg, outputName, mimeFor(kind as MediaKind, format));
  } finally {
    ffmpeg.off('progress', listener);
  }
}

/** failure turns the last ffmpeg lines into a stable, path-free error. */
function failure(logs: string[], inputName: string, outputName: string): ConversionError {
  const tail = logs
    .slice(-4)
    .join(' | ')
    .replaceAll(inputName, 'input')
    .replaceAll(outputName, 'output');
  if (/Invalid data|could not find codec|Unknown encoder/i.test(tail)) {
    return new ConversionError('unsupported', tail);
  }
  return new ConversionError('encode_failed', tail.slice(-600));
}

/** reducePlan lowers both bitrates before the single verification retry. */
export function reducePlan(plan: Plan | undefined): Plan | undefined {
  if (!plan) return plan;
  return {
    ...plan,
    video_bitrate_kbps: plan.video_bitrate_kbps
      ? Math.max(50, Math.floor(plan.video_bitrate_kbps * 0.85))
      : undefined,
    audio_bitrate_kbps: plan.audio_bitrate_kbps
      ? Math.max(32, Math.floor(plan.audio_bitrate_kbps * 0.85))
      : undefined,
  };
}
