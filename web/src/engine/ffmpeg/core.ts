// ffmpeg.wasm lifecycle: lazy load, progress, serialized exec, probing and
// cancellation. The core is served from `/ffmpeg/` (copied from node_modules by
// scripts/sync-ffmpeg-core.mjs), so the app works offline after the first load.
import { FFmpeg } from '@ffmpeg/ffmpeg';

import { fetchWithProgress } from '@/engine/ffmpeg/fetch';
import { ConversionError } from '@/lib/errors';

/** CORE_VERSION must match @ffmpeg/core in package.json. */
export const CORE_VERSION = '0.12.10';
const CORE_URL = `/ffmpeg/ffmpeg-core.js?v=${CORE_VERSION}`;
const WASM_URL = `/ffmpeg/ffmpeg-core.wasm?v=${CORE_VERSION}`;

let instance: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;
let loadAbort: AbortController | null = null;
let engineLock: Promise<unknown> = Promise.resolve();

/** EngineStage is reported while the core downloads and initializes. */
export interface EngineStage {
  phase: 'download' | 'init';
  percent: number;
}

/**
 * loadEngine returns the shared FFmpeg instance, downloading and initializing
 * the core on first use.
 */
export function loadEngine(onStage: (stage: EngineStage) => void): Promise<FFmpeg> {
  if (instance) return Promise.resolve(instance);
  if (!loading) {
    loadAbort = new AbortController();
    loading = createEngine(onStage, loadAbort.signal).catch((error: unknown) => {
      loading = null;
      loadAbort = null;
      if (error instanceof ConversionError) throw error;
      throw new ConversionError('engine', error instanceof Error ? error.message : String(error));
    });
  }
  return loading;
}

async function createEngine(onStage: (stage: EngineStage) => void, signal: AbortSignal): Promise<FFmpeg> {
  onStage({ phase: 'download', percent: 0 });
  const core = await fetchWithProgress(CORE_URL, signal, (percent) =>
    onStage({ phase: 'download', percent: percent * 0.02 }),
  );
  const wasm = await fetchWithProgress(WASM_URL, signal, (percent) =>
    onStage({ phase: 'download', percent: 2 + percent * 0.93 }),
  );
  if (signal.aborted) throw new DOMException('aborted', 'AbortError');

  const coreURL = URL.createObjectURL(new Blob([arrayBufferOf(core)], { type: 'text/javascript' }));
  const wasmURL = URL.createObjectURL(new Blob([arrayBufferOf(wasm)], { type: 'application/wasm' }));
  try {
    const ffmpeg = new FFmpeg();
    await ffmpeg.load({ coreURL, wasmURL });
    instance = ffmpeg;
    onStage({ phase: 'init', percent: 100 });
    return ffmpeg;
  } catch {
    // Some browsers refuse blob: module imports under a strict CSP. Retry with
    // the same-origin URLs the HTTP handler serves (and caches immutably).
    const ffmpeg = new FFmpeg();
    await ffmpeg.load({ coreURL: CORE_URL, wasmURL: WASM_URL });
    instance = ffmpeg;
    onStage({ phase: 'init', percent: 100 });
    return ffmpeg;
  } finally {
    URL.revokeObjectURL(coreURL);
    URL.revokeObjectURL(wasmURL);
    loadAbort = null;
  }
}

/** isEngineLoaded reports whether a usable core is in memory. */
export function isEngineLoaded(): boolean {
  return instance !== null;
}

/** arrayBufferOf copies a typed array into a plain ArrayBuffer BlobPart. */
function arrayBufferOf(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

/** cancelLocalEngine terminates the worker and drops the instance. */
export function cancelLocalEngine(): void {
  loadAbort?.abort();
  const current = instance;
  instance = null;
  loading = null;
  loadAbort = null;
  current?.terminate();
}

/** withEngineLock serializes conversions; FFmpeg cannot run two execs at once. */
export function withEngineLock<T>(work: () => Promise<T>): Promise<T> {
  const next = engineLock.then(work, work);
  engineLock = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/** runExec runs ffmpeg and records its log lines. */
export async function runExec(ffmpeg: FFmpeg, args: string[], logs: string[]): Promise<number> {
  const listener = ({ message }: { message: string }) => {
    logs.push(message);
    if (logs.length > 40) logs.shift();
  };
  ffmpeg.on('log', listener);
  try {
    return await ffmpeg.exec(args);
  } finally {
    ffmpeg.off('log', listener);
  }
}

/** FFmpegProbe is the metadata parsed from ffmpeg's banner. */
export interface FFmpegProbe {
  duration: number;
  width?: number;
  height?: number;
  hasAudio: boolean;
}

/** probeWithFFmpeg reads duration/streams from `ffmpeg -i` output. */
export async function probeWithFFmpeg(ffmpeg: FFmpeg, input: string): Promise<FFmpegProbe> {
  const logs: string[] = [];
  try {
    await runExec(ffmpeg, ['-hide_banner', '-i', input], logs);
  } catch {
    // `ffmpeg -i` exits non-zero on purpose; the banner is the output.
  }
  const text = logs.join('\n');
  const durationMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duration = durationMatch
    ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
    : 0;
  const videoMatch = text.match(/Stream #.*Video:.*?(\d{2,5})x(\d{2,5})/);
  return {
    duration,
    width: videoMatch ? Number(videoMatch[1]) : undefined,
    height: videoMatch ? Number(videoMatch[2]) : undefined,
    hasAudio: /Stream #.*Audio:/.test(text),
  };
}

/** readBlob turns a MEMFS file into a typed Blob. */
export async function readBlob(ffmpeg: FFmpeg, name: string, type: string): Promise<Blob> {
  const data = await ffmpeg.readFile(name);
  if (typeof data === 'string') {
    throw new ConversionError('encode_failed', 'the encoder returned text instead of bytes');
  }
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return new Blob([copy.buffer], { type });
}

/** removeFile ignores a missing file. */
export async function removeFile(ffmpeg: FFmpeg, name: string): Promise<void> {
  try {
    await ffmpeg.deleteFile(name);
  } catch {
    // The file was never written or already removed.
  }
}
