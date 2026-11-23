// ffmpeg argument builders for the browser engine. They mirror the server's
// command shape so a file converted locally and on the server looks the same.
import type { FFmpegProbe } from '@/engine/ffmpeg/core';
import {
  AUDIO_CODECS,
  VIDEO_CODECS,
  containerArgs,
  crfFor,
  scaleFilter,
  videoRateArgs,
} from '@/engine/ffmpeg/codecs';
import type { Plan, QualityPreset } from '@/lib/types';

export interface LocalArgsOptions {
  kind: 'audio' | 'video';
  input: string;
  output: string;
  format: string;
  targetBytes?: number;
  plan?: Plan;
  probe: Pick<FFmpegProbe, 'duration' | 'width' | 'height' | 'hasAudio'>;
  videoPreset: QualityPreset;
  audioKbps: number;
  scale: string;
  fps: number;
  passlog: string;
}

export interface LocalArgs {
  /** pass1 is present only for a two-pass target encode. */
  pass1?: string[];
  /** pass2 is the final encode. */
  pass2: string[];
  /** stages describes the progress window of each command. */
  stages: Array<{ from: number; to: number }>;
}

/** buildLocalArgs returns the command (or two commands) for a local job. */
export function buildLocalArgs(options: LocalArgsOptions): LocalArgs {
  if (options.kind === 'audio' || options.format === 'mp3') {
    return {
      pass2: audioArgs(options),
      stages: [{ from: 0, to: 100 }],
    };
  }
  if (options.format === 'gif') {
    return {
      pass2: gifArgs(options),
      stages: [{ from: 0, to: 100 }],
    };
  }
  if (options.targetBytes && options.plan) {
    return targetVideoArgs(options);
  }
  return {
    pass2: qualityVideoArgs(options),
    stages: [{ from: 0, to: 100 }],
  };
}

function audioArgs(options: LocalArgsOptions): string[] {
  const codecs = AUDIO_CODECS[options.format];
  if (!codecs?.audio) throw new Error(`unsupported audio output ${options.format}`);
  const args = ['-y', '-i', options.input, '-vn', '-sn', '-dn', '-map', '0:a:0', '-c:a', codecs.audio];
  if (codecs.audio !== 'flac' && codecs.audio !== 'pcm_s16le') {
    const kbps = options.targetBytes
      ? options.plan?.audio_bitrate_kbps ?? options.audioKbps
      : options.audioKbps;
    args.push('-b:a', `${Math.max(8, kbps)}k`);
  }
  if (codecs.muxer) args.push('-f', codecs.muxer);
  args.push(...containerArgs(options.format), options.output);
  return args;
}

function qualityVideoArgs(options: LocalArgsOptions): string[] {
  const codecs = VIDEO_CODECS[options.format];
  if (!codecs?.video) throw new Error(`unsupported video output ${options.format}`);
  const crf = crfFor(options.videoPreset, codecs.video);
  const args = ['-y', '-i', options.input, '-map', '0:v:0'];
  if (options.probe.hasAudio) args.push('-map', '0:a:0?');
  args.push('-c:v', codecs.video);
  if (codecs.video === 'libx264') {
    args.push('-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p');
  } else {
    args.push('-crf', String(crf), '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2');
  }
  const filter =
    scaleFilter(options.scale) ||
    (codecs.video === 'libx264' ? 'scale=trunc(iw/2)*2:trunc(ih/2)*2' : '');
  if (filter) args.push('-vf', filter);
  if (options.fps > 0) args.push('-r', String(options.fps));
  if (codecs.audio && options.probe.hasAudio) {
    args.push('-c:a', codecs.audio, '-b:a', `${Math.max(8, options.audioKbps)}k`);
  }
  args.push(...containerArgs(options.format), options.output);
  return args;
}

function targetVideoArgs(options: LocalArgsOptions): LocalArgs {
  const plan = options.plan as Plan;
  const codecs = VIDEO_CODECS[options.format];
  if (!codecs?.video) throw new Error(`unsupported video output ${options.format}`);
  const filter =
    scaleFilter(options.scale) ||
    (codecs.video === 'libx264' ? 'scale=trunc(iw/2)*2:trunc(ih/2)*2' : '');
  const videoKbps = Math.max(50, plan.video_bitrate_kbps ?? 0);
  const audioKbps = plan.audio_bitrate_kbps ?? 0;

  const first = ['-y', '-i', options.input, '-map', '0:v:0', '-c:v', codecs.video];
  first.push(...videoRateArgs(codecs.video, videoKbps));
  if (filter) first.push('-vf', filter);
  if (options.fps > 0) first.push('-r', String(options.fps));
  first.push('-pass', '1', '-passlogfile', options.passlog, '-an', '-sn', '-dn', '-f', 'null', '-');

  const second = ['-y', '-i', options.input, '-map', '0:v:0'];
  if (options.probe.hasAudio && audioKbps > 0) second.push('-map', '0:a:0?');
  second.push('-c:v', codecs.video);
  second.push(...videoRateArgs(codecs.video, videoKbps));
  if (filter) second.push('-vf', filter);
  if (options.fps > 0) second.push('-r', String(options.fps));
  second.push('-pass', '2', '-passlogfile', options.passlog);
  if (options.probe.hasAudio && audioKbps > 0 && codecs.audio) {
    second.push('-c:a', codecs.audio, '-b:a', `${audioKbps}k`);
  }
  second.push(...containerArgs(options.format), options.output);

  return {
    pass1: first,
    pass2: second,
    stages: [
      { from: 0, to: 49 },
      { from: 49, to: 100 },
    ],
  };
}

function gifArgs(options: LocalArgsOptions): string[] {
  let filter = 'fps=12';
  const scale = scaleFilter(options.scale);
  if (scale) filter += `,${scale}`;
  return [
    '-y',
    '-i',
    options.input,
    '-filter_complex',
    `${filter},split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
    '-loop',
    '0',
    options.output,
  ];
}
