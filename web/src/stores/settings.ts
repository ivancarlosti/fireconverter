// Persisted preferences. They are defaults only: every file card keeps its own
// settings in memory, so changing a default never rewrites a queued file.
import { defineStore } from 'pinia';
import { ref } from 'vue';

import type { Engine, FileSettings, MediaKind, QualityPreset } from '@/lib/types';

/** PREFERENCES_KEY is versioned: a future breaking change can migrate it. */
const PREFERENCES_KEY = 'fireconverter.preferences.v1';

export interface Preferences {
  imageFormat: string;
  imageQuality: number;
  audioFormat: string;
  audioBitrate: number;
  videoFormat: string;
  videoPreset: QualityPreset;
  videoEngine: Engine;
  autoDownload: boolean;
}

/** DEFAULT_PREFERENCES is what a first visit starts with. */
export const DEFAULT_PREFERENCES: Preferences = {
  imageFormat: 'webp',
  imageQuality: 82,
  audioFormat: 'mp3',
  audioBitrate: 192,
  videoFormat: 'mp4',
  videoPreset: 'balanced',
  videoEngine: 'server',
  autoDownload: false,
};

const IMAGE_FORMATS = new Set(['jpg', 'png', 'webp', 'avif']);
const AUDIO_FORMATS = new Set(['mp3', 'm4a', 'aac', 'ogg', 'opus', 'flac', 'wav']);
const VIDEO_FORMATS = new Set(['mp4', 'webm', 'mkv', 'mov', 'gif', 'mp3']);
const PRESETS = new Set<QualityPreset>(['high', 'balanced', 'small']);
const ENGINES = new Set<Engine>(['local', 'server']);

function readPreferences(): Preferences {
  try {
    const raw = window.localStorage.getItem(PREFERENCES_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      imageFormat: IMAGE_FORMATS.has(String(parsed.imageFormat)) ? String(parsed.imageFormat) : DEFAULT_PREFERENCES.imageFormat,
      imageQuality: Number.isFinite(parsed.imageQuality) ? Math.min(100, Math.max(1, Number(parsed.imageQuality))) : DEFAULT_PREFERENCES.imageQuality,
      audioFormat: AUDIO_FORMATS.has(String(parsed.audioFormat)) ? String(parsed.audioFormat) : DEFAULT_PREFERENCES.audioFormat,
      audioBitrate: Number.isFinite(parsed.audioBitrate) ? Math.min(320, Math.max(64, Number(parsed.audioBitrate))) : DEFAULT_PREFERENCES.audioBitrate,
      videoFormat: VIDEO_FORMATS.has(String(parsed.videoFormat)) ? String(parsed.videoFormat) : DEFAULT_PREFERENCES.videoFormat,
      videoPreset: PRESETS.has(parsed.videoPreset as QualityPreset) ? (parsed.videoPreset as QualityPreset) : DEFAULT_PREFERENCES.videoPreset,
      videoEngine: ENGINES.has(parsed.videoEngine as Engine) ? (parsed.videoEngine as Engine) : DEFAULT_PREFERENCES.videoEngine,
      autoDownload: parsed.autoDownload === true,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const preferences = ref<Preferences>(readPreferences());

  function persist(): void {
    try {
      window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences.value));
    } catch {
      // Private mode: the defaults still apply for this session.
    }
  }

  function update(patch: Partial<Preferences>): void {
    preferences.value = { ...preferences.value, ...patch };
    persist();
  }

  function reset(): void {
    preferences.value = { ...DEFAULT_PREFERENCES };
    persist();
  }

  /** fileDefaults builds the per-file settings of a newly added file. */
  function fileDefaults(kind: MediaKind, context: { serverAvailable: boolean; avif: boolean }): FileSettings {
    const prefs = preferences.value;
    if (kind === 'image') {
      const format = prefs.imageFormat === 'avif' && !context.avif ? 'webp' : prefs.imageFormat;
      return {
        format,
        mode: 'quality',
        quality: prefs.imageQuality,
        targetMB: 2,
        width: '',
        height: '',
        fit: 'contain',
        noUpscale: true,
        background: '#ffffff',
        audioKbps: prefs.audioBitrate,
        videoPreset: prefs.videoPreset,
        scale: '',
        fps: '',
        engine: 'local',
      };
    }
    if (kind === 'audio') {
      return {
        format: prefs.audioFormat,
        mode: 'quality',
        quality: prefs.imageQuality,
        targetMB: 8,
        width: '',
        height: '',
        fit: 'contain',
        noUpscale: true,
        background: '#ffffff',
        audioKbps: prefs.audioBitrate,
        videoPreset: prefs.videoPreset,
        scale: '',
        fps: '',
        engine: 'local',
      };
    }
    return {
      format: prefs.videoFormat,
      mode: 'quality',
      quality: prefs.imageQuality,
      targetMB: 20,
      width: '',
      height: '',
      fit: 'contain',
      noUpscale: true,
      background: '#ffffff',
      audioKbps: prefs.audioBitrate,
      videoPreset: prefs.videoPreset,
      scale: '',
      fps: '',
      engine: prefs.videoEngine === 'server' && context.serverAvailable ? 'server' : 'local',
    };
  }

  return { preferences, update, reset, fileDefaults };
});
