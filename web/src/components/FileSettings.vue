<script setup lang="ts">
// FileSettings — output, mode and engine, with the detailed controls split out.
import { Cpu, RotateCcw, Server, SlidersHorizontal } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import Alert from '@/components/ui/Alert.vue';
import Button from '@/components/ui/Button.vue';
import FileAdvancedSettings from '@/components/FileAdvancedSettings.vue';
import FileModeControl from '@/components/FileModeControl.vue';
import Label from '@/components/ui/Label.vue';
import SegmentedControl, { type SegmentOption } from '@/components/ui/SegmentedControl.vue';
import Select, { type SelectOption } from '@/components/ui/Select.vue';
import { formatOptions, supportsTarget } from '@/lib/formats';
import type { Engine, FileItem, FileSettings } from '@/lib/types';
import { useConverterStore } from '@/stores/converter';
import { useSystemStore } from '@/stores/system';

const props = defineProps<{ item: FileItem }>();
const store = useConverterStore();
const system = useSystemStore();
const { t } = useI18n();
const advanced = ref(false);

const isVideo = computed(() => props.item.kind === 'video');
const isAudio = computed(() => props.item.kind === 'audio');

const outputOptions = computed<SelectOption[]>(() =>
  formatOptions(props.item.kind, props.item.settings.engine).filter(
    (option) => option.value !== 'avif' || store.avifAvailable,
  ),
);
const modeOptions = computed<SegmentOption[]>(() => [
  { value: 'quality', label: t('file.qualityMode') },
  { value: 'target', label: t('file.targetMode'), disabled: !targetSupported.value },
]);
const engineOptions = computed<SegmentOption[]>(() => [
  { value: 'server', label: t('file.server'), icon: Server, disabled: !system.serverAvailable },
  { value: 'local', label: t('file.local'), icon: Cpu },
]);
const targetSupported = computed(() => supportsTarget(props.item.kind, props.item.settings.format));

function update(patch: Partial<FileSettings>): void {
  store.updateSettings(props.item.id, patch);
}
</script>

<template>
  <div class="space-y-4 border-t border-border p-4">
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div class="space-y-1.5">
        <Label for="file-format">{{ t('file.output') }}</Label>
        <Select
          id="file-format"
          :model-value="item.settings.format"
          :options="outputOptions"
          @update:model-value="update({ format: String($event) })"
        />
      </div>

      <div class="space-y-1.5">
        <Label>{{ t('file.mode') }}</Label>
        <SegmentedControl
          :model-value="item.settings.mode"
          :options="modeOptions"
          :label="t('file.mode')"
          data-testid="mode-control"
          @update:model-value="update({ mode: $event as 'quality' | 'target' })"
        />
      </div>

      <FileModeControl :item="item" />
    </div>

    <div v-if="isVideo" class="space-y-1.5">
      <Label>{{ t('file.engine') }}</Label>
      <SegmentedControl
        :model-value="item.settings.engine"
        :options="engineOptions"
        :label="t('file.engine')"
        @update:model-value="update({ engine: $event as Engine })"
      />
      <p class="text-xs text-muted-foreground">
        {{ item.settings.engine === 'server' ? t('file.serverHint') : t('file.localHint') }}
      </p>
      <Alert v-if="item.settings.engine === 'local'" tone="muted" :message="t('file.localVideoWarn')" />
      <Alert
        v-if="!system.serverAvailable && !system.loading"
        tone="warning"
        :message="t('settings.serverUnavailable')"
      />
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <Button v-if="!isAudio" variant="ghost" size="sm" @click="advanced = !advanced">
        <SlidersHorizontal class="h-4 w-4" aria-hidden="true" />
        {{ advanced ? t('file.hideAdvanced') : t('file.advanced') }}
      </Button>
      <Button variant="ghost" size="sm" @click="store.resetFileSettings(item.id)">
        <RotateCcw class="h-4 w-4" aria-hidden="true" />
        {{ t('file.resetSettings') }}
      </Button>
    </div>

    <FileAdvancedSettings v-if="advanced && !isAudio" :item="item" />
  </div>
</template>
