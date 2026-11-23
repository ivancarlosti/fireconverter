// Server capabilities and limits, loaded once at boot and refreshable.
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { getFormats, getHealth } from '@/lib/api';
import type { FormatsResponse, Health } from '@/lib/types';

export const useSystemStore = defineStore('system', () => {
  const health = ref<Health | null>(null);
  const formats = ref<FormatsResponse | null>(null);
  const loading = ref(false);
  const error = ref('');

  const serverAvailable = computed(() => health.value?.server_conversion === true);
  const maxUploadBytes = computed(() => health.value?.max_upload_bytes ?? 2 * 1024 * 1024 * 1024);
  const targetMaxMB = computed(() =>
    Math.floor((health.value?.target_size_max_bytes ?? 4 * 1024 * 1024 * 1024) / 1_000_000),
  );
  const version = computed(() => health.value?.version.version ?? 'dev');

  async function load(): Promise<void> {
    if (loading.value) return;
    loading.value = true;
    error.value = '';
    try {
      const [nextHealth, nextFormats] = await Promise.all([getHealth(), getFormats()]);
      health.value = nextHealth;
      formats.value = nextFormats;
    } catch (failure) {
      error.value = failure instanceof Error ? failure.message : String(failure);
      health.value = null;
      formats.value = null;
    } finally {
      loading.value = false;
    }
  }

  /** resolveEngine downgrades a stored server preference when the server cannot encode. */
  function resolveEngine(engine: 'local' | 'server'): 'local' | 'server' {
    return engine === 'server' && serverAvailable.value ? 'server' : 'local';
  }

  return {
    health,
    formats,
    loading,
    error,
    serverAvailable,
    maxUploadBytes,
    targetMaxMB,
    version,
    load,
    resolveEngine,
  };
});
