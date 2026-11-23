// Converter queue and orchestration.
//
// Images and audio never leave the browser; video runs locally or on the
// server. Target-size jobs are staged: a plan is produced first, the review
// dialog confirms it, and only then does the encode start.
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { convertLocal, probeLocalMedia } from '@/engine/ffmpeg/convert';
import { cancelLocalEngine } from '@/engine/ffmpeg/core';
import { convertImage, supportsAvif } from '@/engine/image';
import { i18n } from '@/i18n';
import { cancelJob, deleteJob, getJob, uploadJob, confirmJob, ApiError, isAbortError } from '@/lib/api';
import { errorCodeOf, errorDetailOf, ConversionError } from '@/lib/errors';
import { formatBytes } from '@/lib/format';
import { canPreviewImage, probeMedia } from '@/lib/media';
import { kindOf, outputName, supportsTarget } from '@/lib/formats';
import { buildPlan, targetBytesFromMB } from '@/lib/plan';
import type { FileItem, FileSettings, FileStatus, MediaKind, Plan } from '@/lib/types';
import { useFeedbackStore } from '@/stores/feedback';
import { useSettingsStore } from '@/stores/settings';
import { useSystemStore } from '@/stores/system';

const MAX_FILES = 50;

/** PlanEntry is one target-size review waiting for confirmation. */
export interface PlanEntry {
  itemId: string;
  itemName: string;
  kind: MediaKind;
  targetMB: number;
  plan?: Plan;
  /** serverJobId is set when the file is already uploaded and awaiting confirm. */
  serverJobId?: string;
}

function translate(key: string, params?: Record<string, unknown>): string {
  return i18n.global.t(key, params ?? {});
}

function isActive(status: FileStatus): boolean {
  return (
    status === 'uploading' ||
    status === 'awaiting' ||
    status === 'queued' ||
    status === 'converting'
  );
}

function kindOfFile(file: File): MediaKind | null {
  return kindOf(file);
}

export const useConverterStore = defineStore('converter', () => {
  const settings = useSettingsStore();
  const system = useSystemStore();
  const feedback = useFeedbackStore();

  const files = ref<FileItem[]>([]);
  const planQueue = ref<PlanEntry[]>([]);
  const avifAvailable = ref(false);
  const queueRunning = ref(false);

  // Non-reactive bookkeeping.
  const controllers = new Map<string, AbortController>();
  const timers = new Map<string, number>();
  const pollFailures = new Map<string, number>();

  const activePlan = computed<PlanEntry | null>(() => planQueue.value[0] ?? null);
  const hasActive = computed(() => files.value.some((item) => isActive(item.status)));
  const busy = computed(() => hasActive.value || queueRunning.value);
  const readyFiles = computed(() =>
    files.value.filter(
      (item) => item.status === 'ready' || item.status === 'error' || item.status === 'canceled',
    ),
  );
  const doneCount = computed(() => files.value.filter((item) => item.status === 'done').length);
  const totalSize = computed(() => files.value.reduce((sum, item) => sum + item.size, 0));
  const canConvertAll = computed(() => readyFiles.value.length > 0);

  void supportsAvif().then((supported) => {
    avifAvailable.value = supported;
  });

  function fileById(id: string): FileItem | undefined {
    return files.value.find((item) => item.id === id);
  }

  async function addFiles(input: File[]): Promise<void> {
    const avif = await supportsAvif();
    avifAvailable.value = avif;
    const free = MAX_FILES - files.value.length;
    if (free <= 0) {
      feedback.fail(translate('upload.tooMany', { count: MAX_FILES }));
      return;
    }
    if (input.length > free) {
      feedback.info(translate('upload.tooMany', { count: MAX_FILES }));
    }

    for (const file of input.slice(0, free)) {
      const kind = kindOfFile(file);
      if (!kind) {
        feedback.fail(translate('upload.unsupported', { name: file.name }));
        continue;
      }
      if (file.size === 0) {
        feedback.fail(translate('upload.emptyFile', { name: file.name }));
        continue;
      }
      const item: FileItem = {
        id: crypto.randomUUID(),
        file,
        kind,
        name: file.name,
        size: file.size,
        status: 'ready',
        progress: 0,
        stage: 'ready',
        warnings: [],
        settings: settings.fileDefaults(kind, {
          serverAvailable: system.serverAvailable,
          avif,
        }),
      };
      if (canPreviewImage(kind, file)) {
        item.previewUrl = URL.createObjectURL(file);
      }
      files.value = [...files.value, item];
      void probeMedia(file, kind).then((probe) => {
        const current = fileById(item.id);
        if (!current) return;
        current.probe = probe;
        if (kind === 'video' && current.settings.engine === 'server' && !system.serverAvailable) {
          current.settings.engine = 'local';
        }
      });
    }
  }

  function updateSettings(id: string, patch: Partial<FileSettings>): void {
    const item = fileById(id);
    if (!item || isActive(item.status)) return;

    if (patch.format === 'avif' && !avifAvailable.value) {
      feedback.fail(translate('errors.avifUnsupported'));
      patch = { ...patch, format: 'webp' };
    }
    if (item.status !== 'ready') {
      resetItem(item);
    }
    Object.assign(item.settings, patch);

    if (item.kind !== 'video') {
      item.settings.engine = 'local';
    }
    if (item.settings.mode === 'target' && !supportsTarget(item.kind, item.settings.format)) {
      item.settings.mode = 'quality';
    }
    if (!Number.isFinite(item.settings.targetMB) || item.settings.targetMB < 0.05) {
      item.settings.targetMB = 0.05;
    }
    if (item.settings.targetMB > system.targetMaxMB) {
      item.settings.targetMB = system.targetMaxMB;
    }
  }

  function resetFileSettings(id: string): void {
    const item = fileById(id);
    if (!item || isActive(item.status)) return;
    resetItem(item);
    item.settings = settings.fileDefaults(item.kind, {
      serverAvailable: system.serverAvailable,
      avif: avifAvailable.value,
    });
  }

  function resetItem(item: FileItem): void {
    stopPolling(item.id);
    controllers.get(item.id)?.abort();
    controllers.delete(item.id);
    if (item.result?.url) URL.revokeObjectURL(item.result.url);
    if (item.jobId) {
      const jobId = item.jobId;
      void deleteJob(jobId).catch(() => undefined);
    }
    planQueue.value = planQueue.value.filter((entry) => entry.itemId !== item.id);
    item.result = undefined;
    item.jobId = undefined;
    item.plan = undefined;
    item.errorCode = undefined;
    item.errorMessage = undefined;
    item.warnings = [];
    item.progress = 0;
    item.stage = 'ready';
    item.status = 'ready';
  }

  function removeFile(id: string): void {
    const item = fileById(id);
    if (!item) return;
    if (isActive(item.status)) {
      void cancelFile(id);
    }
    stopPolling(id);
    controllers.get(id)?.abort();
    controllers.delete(id);
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    if (item.result?.url) URL.revokeObjectURL(item.result.url);
    if (item.jobId) void deleteJob(item.jobId).catch(() => undefined);
    planQueue.value = planQueue.value.filter((entry) => entry.itemId !== id);
    files.value = files.value.filter((candidate) => candidate.id !== id);
  }

  function clearFinished(): void {
    for (const item of [...files.value]) {
      if (item.status === 'done' || item.status === 'error' || item.status === 'canceled') {
        removeFile(item.id);
      }
    }
  }

  function clearAll(): void {
    if (hasActive.value) {
      feedback.fail(translate('errors.clearWhileBusy'));
      return;
    }
    for (const item of [...files.value]) {
      removeFile(item.id);
    }
    planQueue.value = [];
  }

  async function convertFile(id: string): Promise<void> {
    const item = fileById(id);
    if (!item || isActive(item.status) || item.status === 'done') return;
    if (!validSettings(item)) return;
    if (item.settings.mode === 'target') {
      await preparePlan(item);
      return;
    }
    await startConversion(item);
  }

  async function convertAll(): Promise<void> {
    if (queueRunning.value) return;
    queueRunning.value = true;
    try {
      for (const item of [...readyFiles.value]) {
        await convertFile(item.id);
      }
    } finally {
      queueRunning.value = false;
    }
  }

  function validSettings(item: FileItem): boolean {
    if (item.settings.mode === 'target') {
      const target = item.settings.targetMB;
      if (!Number.isFinite(target) || target < 0.05) {
        feedback.fail(translate('errors.targetRange', { min: 0.05 }));
        return false;
      }
      if (target > system.targetMaxMB) {
        feedback.fail(translate('errors.targetTooLarge', { max: system.targetMaxMB }));
        return false;
      }
      if (!supportsTarget(item.kind, item.settings.format)) {
        feedback.fail(translate('errors.targetUnsupported'));
        return false;
      }
    }
    if (item.kind === 'video') {
      const scale = item.settings.scale.trim();
      if (scale !== '' && !/^\d{2,5}x\d{2,5}$/i.test(scale)) {
        feedback.fail(translate('errors.scaleInvalid'));
        return false;
      }
      const fps = Number(item.settings.fps);
      if (item.settings.fps.trim() !== '' && (!Number.isFinite(fps) || fps <= 0 || fps > 240)) {
        feedback.fail(translate('errors.fpsInvalid'));
        return false;
      }
    }
    return true;
  }

  async function preparePlan(item: FileItem): Promise<void> {
    if (item.settings.mode !== 'target') return;
    const targetMB = item.settings.targetMB;
    const targetBytes = targetBytesFromMB(targetMB);

    if (item.kind === 'image') {
      item.status = 'awaiting';
      item.stage = 'awaiting';
      item.progress = 0;
      planQueue.value = [
        ...planQueue.value.filter((entry) => entry.itemId !== item.id),
        { itemId: item.id, itemName: item.name, kind: item.kind, targetMB },
      ];
      return;
    }

    const engine = item.kind === 'video' ? system.resolveEngine(item.settings.engine) : 'local';
    item.settings.engine = engine;

    if (engine === 'server') {
      await uploadServerPlan(item, targetMB);
      return;
    }

    item.status = 'converting';
    item.stage = 'planning';
    item.progress = 0;
    try {
      let probe = item.probe;
      if (!probe || !probe.duration) {
        item.stage = 'engine';
        const actual = await probeLocalMedia(item.file);
        probe = {
          duration: actual.duration,
          width: actual.width,
          height: actual.height,
          hasAudio: item.kind === 'audio' ? true : actual.hasAudio,
        };
        item.probe = probe;
      }
      const plan = buildPlan(
        item.kind,
        item.settings.format,
        probe,
        targetBytes,
        item.settings.audioKbps,
        normalizedScale(item.settings.scale),
        parseFps(item.settings.fps),
      );
      item.plan = plan;
      item.status = 'awaiting';
      item.stage = 'awaiting';
      item.progress = 0;
      planQueue.value = [
        ...planQueue.value.filter((entry) => entry.itemId !== item.id),
        { itemId: item.id, itemName: item.name, kind: item.kind, targetMB, plan },
      ];
    } catch (error) {
      handleFailure(item, error);
    }
  }

  async function uploadServerPlan(item: FileItem, targetMB: number): Promise<void> {
    item.status = 'uploading';
    item.stage = 'uploading';
    item.progress = 0;
    const controller = new AbortController();
    controllers.set(item.id, controller);
    try {
      const job = await uploadJob(
        item.file,
        {
          output: item.settings.format,
          target_mb: targetMB,
          audio_kbps: item.settings.audioKbps,
          quality: item.settings.videoPreset,
          scale: normalizedScale(item.settings.scale),
          fps: parseFps(item.settings.fps),
        },
        (percent) => {
          item.progress = percent;
        },
        controller.signal,
      );
      controllers.delete(item.id);
      item.jobId = job.id;
      item.plan = job.plan;
      if (job.plan) {
        item.status = 'awaiting';
        item.stage = 'awaiting';
        item.progress = 0;
        planQueue.value = [
          ...planQueue.value.filter((entry) => entry.itemId !== item.id),
          {
            itemId: item.id,
            itemName: item.name,
            kind: item.kind,
            targetMB,
            plan: job.plan,
            serverJobId: job.id,
          },
        ];
        return;
      }
      applyJob(item, job);
      if (!isTerminal(job.status)) startPolling(item, job.id);
    } catch (error) {
      controllers.delete(item.id);
      handleFailure(item, error);
    }
  }

  async function startConversion(item: FileItem, plan?: Plan, target = false): Promise<void> {
    const engine = item.kind === 'video' ? system.resolveEngine(item.settings.engine) : 'local';
    item.settings.engine = engine;
    item.errorCode = undefined;
    item.errorMessage = undefined;
    item.warnings = [];
    if (item.result?.url) {
      URL.revokeObjectURL(item.result.url);
      item.result = undefined;
    }

    if (engine === 'server') {
      await startServerConversion(item, plan);
      return;
    }

    item.status = 'converting';
    item.stage = 'encode';
    item.progress = 0;
    try {
      if (item.kind === 'image') {
        const output = await convertImage(
          item.file,
          {
            format: item.settings.format,
            quality: item.settings.quality,
            targetBytes: target ? targetBytesFromMB(item.settings.targetMB) : undefined,
            resize: {
              width: optionalPositive(item.settings.width),
              height: optionalPositive(item.settings.height),
              fit: item.settings.fit,
              noUpscale: item.settings.noUpscale,
            },
            background: item.settings.background,
          },
          (percent) => {
            item.progress = percent;
            item.stage = 'encode';
          },
        );
        finishLocal(item, output.blob, output.width, output.height, 0);
        return;
      }

      const result = await convertLocal(
        item.file,
        {
          kind: item.kind,
          format: item.settings.format,
          targetBytes: target ? targetBytesFromMB(item.settings.targetMB) : undefined,
          plan,
          probe: item.probe ?? {
            duration: 0,
            width: undefined,
            height: undefined,
            hasAudio: item.kind === 'audio',
          },
          videoPreset: item.settings.videoPreset,
          audioKbps: item.settings.audioKbps,
          scale: normalizedScale(item.settings.scale),
          fps: parseFps(item.settings.fps),
        },
        (percent, stage) => {
          item.progress = Math.max(item.progress, 8 + percent * 0.92);
          item.stage = stage;
        },
        (percent) => {
          item.stage = 'engine';
          item.progress = Math.max(item.progress, percent * 0.08);
        },
      );
      if (result.retried) item.warnings.push('target_retried');
      finishLocal(item, result.blob, result.width, result.height, result.duration);
    } catch (error) {
      handleFailure(item, error);
    }
  }

  function finishLocal(
    item: FileItem,
    blob: Blob,
    width?: number,
    height?: number,
    duration?: number,
  ): void {
    if (item.status === 'canceled' || !fileById(item.id)) return;
    if (item.result?.url) URL.revokeObjectURL(item.result.url);
    item.result = {
      name: outputName(item.name, item.settings.format),
      size: blob.size,
      engine: 'local',
      url: URL.createObjectURL(blob),
      width,
      height,
      duration,
    };
    item.status = 'done';
    item.stage = 'done';
    item.progress = 100;
    feedback.success(translate('file.doneToast', { name: item.name }));
    if (settings.preferences.autoDownload) void downloadFile(item.id);
  }

  function normalizedScale(value: string): string {
    const scale = value.trim();
    return /^\d{2,5}x\d{2,5}$/i.test(scale) ? scale.toLowerCase() : '';
  }

  function parseFps(value: string): number {
    const fps = Number(value);
    return value.trim() !== '' && Number.isFinite(fps) && fps > 0 && fps <= 240 ? fps : 0;
  }

  function optionalPositive(value: string): number | undefined {
    const parsed = Number(value);
    return value.trim() !== '' && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  async function startServerConversion(item: FileItem, plan?: Plan): Promise<void> {
    item.status = plan ? 'queued' : 'uploading';
    item.stage = plan ? 'queued' : 'uploading';
    item.progress = plan ? 0 : 0;

    try {
      if (plan && item.jobId) {
        const job = await confirmJob(item.jobId);
        applyJob(item, job);
        if (!isTerminal(job.status)) startPolling(item, job.id);
        return;
      }

      const controller = new AbortController();
      controllers.set(item.id, controller);
      const job = await uploadJob(
        item.file,
        {
          output: item.settings.format,
          target_mb: plan ? item.settings.targetMB : 0,
          audio_kbps: item.settings.audioKbps,
          quality: item.settings.videoPreset,
          scale: normalizedScale(item.settings.scale),
          fps: parseFps(item.settings.fps),
        },
        (percent) => {
          item.progress = percent;
        },
        controller.signal,
      );
      controllers.delete(item.id);
      applyJob(item, job);
      if (!isTerminal(job.status)) startPolling(item, job.id);
    } catch (error) {
      controllers.delete(item.id);
      handleFailure(item, error);
    }
  }

  function isTerminal(status: string): boolean {
    return status === 'done' || status === 'failed' || status === 'canceled';
  }

  function applyJob(item: FileItem, job: Awaited<ReturnType<typeof getJob>>): void {
    if (!fileById(item.id)) return;
    if (item.jobId && item.jobId !== job.id) return;
    if (item.status === 'canceled' && job.status !== 'canceled') return;
    item.jobId = job.id;
    if (job.plan) item.plan = job.plan;
    if (job.probe && !item.probe) {
      item.probe = {
        duration: job.probe.duration_seconds,
        width: job.probe.width,
        height: job.probe.height,
        hasAudio: job.probe.has_audio,
      };
    }
    item.progress = Math.min(100, Math.max(0, job.progress));
    item.warnings = [...new Set([...item.warnings, ...(job.warnings ?? [])])];
    if (job.stage) item.stage = job.stage;

    switch (job.status) {
      case 'awaiting_confirmation':
        item.status = 'awaiting';
        item.stage = 'awaiting';
        break;
      case 'queued':
        item.status = 'queued';
        item.stage = 'queued';
        break;
      case 'running':
        item.status = 'converting';
        break;
      case 'done':
        item.status = 'done';
        item.stage = 'done';
        item.progress = 100;
        item.result = {
          name: job.output_name,
          size: job.output_size,
          engine: 'server',
          downloadUrl: job.download_url,
          width: job.probe?.width,
          height: job.probe?.height,
          duration: job.probe?.duration_seconds,
        };
        stopPolling(item.id);
        feedback.success(translate('file.doneToast', { name: item.name }));
        if (settings.preferences.autoDownload) void downloadFile(item.id);
        break;
      case 'failed':
        item.status = 'error';
        item.stage = 'failed';
        item.errorCode = job.error_code ?? 'internal';
        item.errorMessage = job.error_message;
        stopPolling(item.id);
        feedback.fail(
          translateError(item.errorCode),
          job.error_message || undefined,
        );
        break;
      case 'canceled':
        item.status = 'canceled';
        item.stage = 'canceled';
        stopPolling(item.id);
        break;
    }
  }

  function startPolling(item: FileItem, jobId: string): void {
    stopPolling(item.id);
    pollFailures.set(item.id, 0);
    const tick = async (): Promise<void> => {
      const current = fileById(item.id);
      if (!current || current.jobId !== jobId) {
        stopPolling(item.id);
        return;
      }
      try {
        const job = await getJob(jobId);
        pollFailures.set(item.id, 0);
        applyJob(current, job);
        if (isTerminal(job.status)) return;
        timers.set(item.id, window.setTimeout(() => void tick(), 900));
      } catch (error) {
        const failures = (pollFailures.get(item.id) ?? 0) + 1;
        pollFailures.set(item.id, failures);
        if (failures >= 3) {
          handleFailure(current, error);
          return;
        }
        timers.set(item.id, window.setTimeout(() => void tick(), 1500));
      }
    };
    void tick();
  }

  function stopPolling(id: string): void {
    const timer = timers.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.delete(id);
    pollFailures.delete(id);
  }

  async function confirmCurrentPlan(): Promise<void> {
    const entry = planQueue.value[0];
    if (!entry) return;
    planQueue.value = planQueue.value.slice(1);
    await confirmEntry(entry);
  }

  function confirmAllPlans(): void {
    const entries = [...planQueue.value];
    planQueue.value = [];
    for (const entry of entries) {
      void confirmEntry(entry);
    }
  }

  async function confirmEntry(entry: PlanEntry): Promise<void> {
    const item = fileById(entry.itemId);
    if (!item) return;
    if (entry.serverJobId) {
      item.status = 'queued';
      item.stage = 'queued';
      item.progress = 0;
      try {
        const job = await confirmJob(entry.serverJobId);
        applyJob(item, job);
        if (!isTerminal(job.status)) startPolling(item, job.id);
      } catch (error) {
        handleFailure(item, error);
      }
      return;
    }
    item.plan = entry.plan;
    await startConversion(item, entry.plan, true);
  }

  function dismissPlans(): void {
    const entries = [...planQueue.value];
    planQueue.value = [];
    for (const entry of entries) {
      const item = fileById(entry.itemId);
      if (!item) continue;
      if (entry.serverJobId) {
        const jobId = entry.serverJobId;
        void cancelJob(jobId).catch(() => undefined);
        void deleteJob(jobId).catch(() => undefined);
        item.jobId = undefined;
      }
      item.plan = undefined;
      item.status = 'ready';
      item.stage = 'ready';
      item.progress = 0;
    }
  }

  async function cancelFile(id: string): Promise<void> {
    const item = fileById(id);
    if (!item || !isActive(item.status)) return;
    const wasAwaiting = item.status === 'awaiting';
    stopPolling(id);
    controllers.get(id)?.abort();
    controllers.delete(id);
    planQueue.value = planQueue.value.filter((entry) => entry.itemId !== id);

    if (item.jobId) {
      const jobId = item.jobId;
      try {
        await cancelJob(jobId);
      } catch {
        // The job may have finished between the click and the request.
      }
      void deleteJob(jobId).catch(() => undefined);
      item.jobId = undefined;
    } else if (item.kind !== 'image') {
      cancelLocalEngine();
    }

    if (wasAwaiting) {
      item.plan = undefined;
      item.status = 'ready';
      item.stage = 'ready';
      item.progress = 0;
      return;
    }
    item.status = 'canceled';
    item.stage = 'canceled';
    item.progress = 0;
  }

  async function downloadFile(id: string): Promise<void> {
    const item = fileById(id);
    const result = item?.result;
    if (!result) return;
    if (result.url) {
      triggerDownload(result.url, result.name);
      return;
    }
    if (result.downloadUrl) {
      // A direct same-origin download streams to disk; fetching it as a Blob
      // would duplicate a multi-gigabyte file in memory.
      triggerDownload(result.downloadUrl, result.name);
    }
  }

  async function downloadAll(): Promise<void> {
    const finished = files.value.filter((item) => item.status === 'done' && item.result);
    for (const item of finished) {
      await downloadFile(item.id);
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    }
  }

  function triggerDownload(url: string, name: string): void {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.rel = 'noopener';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }

  function translateError(code: string): string {
    const key = `errors.${code}`;
    return i18n.global.te(key) ? translate(key) : translate('errors.generic');
  }

  function handleFailure(item: FileItem, error: unknown): void {
    if (!fileById(item.id) || item.status === 'canceled') return;
    if (isAbortError(error) || (error instanceof ConversionError && error.code === 'canceled')) {
      item.status = 'canceled';
      item.stage = 'canceled';
      return;
    }
    const apiError = error instanceof ApiError ? error : null;
    const code = apiError?.code ?? errorCodeOf(error);
    let detail = apiError?.message || errorDetailOf(error);
    if (
      error instanceof ConversionError &&
      error.code === 'target_too_small' &&
      error.minTargetBytes
    ) {
      detail = translate('errors.minimumTarget', { size: formatBytes(error.minTargetBytes) });
    }
    item.status = 'error';
    item.stage = 'failed';
    item.progress = 0;
    item.errorCode = code;
    item.errorMessage = detail;
    feedback.fail(translateError(code), detail || undefined);
  }

  async function convertAgain(id: string): Promise<void> {
    const item = fileById(id);
    if (!item || isActive(item.status)) return;
    resetItem(item);
    await convertFile(id);
  }

  return {
    files,
    planQueue,
    activePlan,
    avifAvailable,
    queueRunning,
    hasActive,
    busy,
    readyFiles,
    doneCount,
    totalSize,
    canConvertAll,
    maxFiles: MAX_FILES,
    addFiles,
    updateSettings,
    resetFileSettings,
    removeFile,
    clearFinished,
    clearAll,
    convertFile,
    convertAgain,
    convertAll,
    confirmCurrentPlan,
    confirmAllPlans,
    dismissPlans,
    cancelFile,
    downloadFile,
    downloadAll,
  };
});
