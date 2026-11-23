<script setup lang="ts">
// FileModeControl — quality vs target size for the selected output.
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import Alert from '@/components/ui/Alert.vue';
import Input from '@/components/ui/Input.vue';
import Label from '@/components/ui/Label.vue';
import Range from '@/components/ui/Range.vue';
import Select, { type SelectOption } from '@/components/ui/Select.vue';
import { isLossless, supportsTarget } from '@/lib/formats';
import type { FileItem, FileSettings, QualityPreset } from '@/lib/types';
import { useConverterStore } from '@/stores/converter';
import { useSystemStore } from '@/stores/system';

const props = defineProps<{ item: FileItem }>();
const store = useConverterStore();
const system = useSystemStore();
const { t } = useI18n();

const isImage = computed(() => props.item.kind === 'image');
const isAudio = computed(() => props.item.kind === 'audio');
const targetSupported = computed(() => supportsTarget(props.item.kind, props.item.settings.format));
const lossless = computed(() => isLossless(props.item.settings.format));

const qualityPresets = computed<SelectOption[]>(() => [
  { value: 'high', label: t('file.high') },
  { value: 'balanced', label: t('file.balanced') },
  { value: 'small', label: t('file.small') },
]);
const bitrates = [96, 128, 192, 256, 320].map((value) => ({
  value,
  label: `${value} kbps`,
}));

function update(patch: Partial<FileSettings>): void {
  store.updateSettings(props.item.id, patch);
}

function onTarget(value: string | number): void {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) update({ targetMB: parsed });
}

function onQuality(value: string | number): void {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) update({ quality: Math.min(100, Math.max(1, parsed)) });
}
</script>

<template>
  <div v-if="item.settings.mode === 'target'" class="space-y-1.5">
    <Label for="file-target" :hint="t('file.targetHelp')">{{ t('file.target') }}</Label>
    <div class="flex items-center gap-2">
      <Input
        id="file-target"
        type="number"
        :model-value="item.settings.targetMB"
        :min="0.05"
        :max="system.targetMaxMB"
        step="0.1"
        numeric
        data-testid="target-input"
        @update:model-value="onTarget"
      />
      <span class="text-sm text-muted-foreground">MB</span>
    </div>
    <p v-if="!targetSupported" class="text-xs text-destructive">{{ t('errors.targetUnsupported') }}</p>
  </div>

  <div v-else-if="isImage" class="space-y-1.5">
    <Label for="file-quality">
      {{ t('file.quality') }}
      <span class="numeric ms-1 text-muted-foreground">{{ item.settings.quality }}</span>
    </Label>
    <div class="flex items-center gap-2">
      <Range
        id="file-quality"
        :model-value="item.settings.quality"
        :min="1"
        :max="100"
        :disabled="item.settings.format === 'png'"
        :label="t('file.quality')"
        @update:model-value="update({ quality: $event })"
      />
      <Input
        type="number"
        class="w-20"
        :model-value="item.settings.quality"
        :min="1"
        :max="100"
        numeric
        @update:model-value="onQuality"
      />
    </div>
  </div>

  <div v-else-if="isAudio" class="space-y-1.5">
    <Label for="file-bitrate" :hint="lossless ? t('file.losslessHint') : ''">
      {{ t('file.bitrate') }}
    </Label>
    <Select
      id="file-bitrate"
      :model-value="item.settings.audioKbps"
      :options="bitrates"
      :disabled="lossless"
      @update:model-value="update({ audioKbps: Number($event) })"
    />
  </div>

  <div v-else class="space-y-1.5">
    <Label for="file-preset">{{ t('file.qualityPreset') }}</Label>
    <Select
      id="file-preset"
      :model-value="item.settings.videoPreset"
      :options="qualityPresets"
      @update:model-value="update({ videoPreset: $event as QualityPreset })"
    />
  </div>

  <Alert
    v-if="item.settings.mode === 'target' && !targetSupported"
    tone="warning"
    class="sm:col-span-2 lg:col-span-3"
    :message="t('errors.targetUnsupported')"
  />
</template>
