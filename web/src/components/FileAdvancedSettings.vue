<script setup lang="ts">
// FileAdvancedSettings — image resize and video scale/FPS.
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import Input from '@/components/ui/Input.vue';
import Label from '@/components/ui/Label.vue';
import Select, { type SelectOption } from '@/components/ui/Select.vue';
import Switch from '@/components/ui/Switch.vue';
import type { FileItem, FileSettings, Fit } from '@/lib/types';
import { useConverterStore } from '@/stores/converter';

const props = defineProps<{ item: FileItem }>();
const store = useConverterStore();
const { t } = useI18n();

const isImage = computed(() => props.item.kind === 'image');
const isVideo = computed(() => props.item.kind === 'video');
const fitOptions = computed<SelectOption[]>(() => [
  { value: 'contain', label: t('file.contain') },
  { value: 'cover', label: t('file.cover') },
  { value: 'stretch', label: t('file.stretch') },
]);

function update(patch: Partial<FileSettings>): void {
  store.updateSettings(props.item.id, patch);
}
</script>

<template>
  <div class="rounded-lg border border-border bg-muted/20 p-3">
    <div v-if="isImage" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div class="space-y-1.5">
        <Label for="file-width">{{ t('file.width') }}</Label>
        <Input
          id="file-width"
          type="number"
          :model-value="item.settings.width"
          min="1"
          placeholder="1920"
          numeric
          @update:model-value="update({ width: String($event) })"
        />
      </div>
      <div class="space-y-1.5">
        <Label for="file-height">{{ t('file.height') }}</Label>
        <Input
          id="file-height"
          type="number"
          :model-value="item.settings.height"
          min="1"
          placeholder="1080"
          numeric
          @update:model-value="update({ height: String($event) })"
        />
      </div>
      <div class="space-y-1.5">
        <Label for="file-fit">{{ t('file.fit') }}</Label>
        <Select
          id="file-fit"
          :model-value="item.settings.fit"
          :options="fitOptions"
          @update:model-value="update({ fit: $event as Fit })"
        />
      </div>
      <div class="space-y-1.5">
        <Label for="file-background">{{ t('file.background') }}</Label>
        <input
          id="file-background"
          type="color"
          :value="item.settings.background"
          class="h-9 w-full cursor-pointer rounded-md border border-input bg-background p-1"
          @input="update({ background: ($event.target as HTMLInputElement).value })"
        />
      </div>
      <label class="flex items-center gap-2 text-sm sm:col-span-2">
        <Switch
          :model-value="item.settings.noUpscale"
          :label="t('file.noUpscale')"
          @update:model-value="update({ noUpscale: $event })"
        />
        {{ t('file.noUpscale') }}
      </label>
    </div>

    <div v-else-if="isVideo" class="grid gap-3 sm:grid-cols-2">
      <div class="space-y-1.5">
        <Label for="file-scale" :hint="t('file.scaleHint')">{{ t('file.scale') }}</Label>
        <Input
          id="file-scale"
          :model-value="item.settings.scale"
          placeholder="1280x720"
          numeric
          @update:model-value="update({ scale: String($event) })"
        />
      </div>
      <div class="space-y-1.5">
        <Label for="file-fps" :hint="t('file.fpsHint')">{{ t('file.fps') }}</Label>
        <Input
          id="file-fps"
          type="number"
          :model-value="item.settings.fps"
          min="1"
          max="240"
          placeholder="30"
          numeric
          @update:model-value="update({ fps: String($event) })"
        />
      </div>
    </div>
  </div>
</template>
