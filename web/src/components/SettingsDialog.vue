<script setup lang="ts">
// SettingsDialog — defaults for new files plus the server/build status.
import { RotateCcw } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import Alert from '@/components/ui/Alert.vue';
import Button from '@/components/ui/Button.vue';
import Dialog from '@/components/ui/Dialog.vue';
import Label from '@/components/ui/Label.vue';
import Range from '@/components/ui/Range.vue';
import SegmentedControl, { type SegmentOption } from '@/components/ui/SegmentedControl.vue';
import Select, { type SelectOption } from '@/components/ui/Select.vue';
import { AUDIO_FORMATS, IMAGE_FORMATS, VIDEO_FORMATS } from '@/lib/formats';
import type { Engine, QualityPreset } from '@/lib/types';
import { useConverterStore } from '@/stores/converter';
import { useSettingsStore } from '@/stores/settings';
import { useSystemStore } from '@/stores/system';

const open = defineModel<boolean>('open', { default: false });
const settings = useSettingsStore();
const system = useSystemStore();
const converter = useConverterStore();
const { t } = useI18n();

const imageFormats = computed<SelectOption[]>(() =>
  IMAGE_FORMATS.filter((format) => format.value !== 'avif' || converter.avifAvailable),
);
const audioFormats = computed<SelectOption[]>(() => AUDIO_FORMATS);
const videoFormats = computed<SelectOption[]>(() => VIDEO_FORMATS);
const bitrates = [96, 128, 192, 256, 320].map((value) => ({
  value,
  label: `${value} kbps`,
}));
const qualityPresets = computed<SelectOption[]>(() => [
  { value: 'high', label: t('file.high') },
  { value: 'balanced', label: t('file.balanced') },
  { value: 'small', label: t('file.small') },
]);
const engines = computed<SegmentOption[]>(() => [
  { value: 'server', label: t('file.server'), disabled: !system.serverAvailable },
  { value: 'local', label: t('file.local') },
]);
</script>

<template>
  <Dialog
    v-model:open="open"
    :title="t('settings.title')"
    :description="t('settings.description')"
    size="lg"
    :close-label="t('common.close')"
  >
    <div class="space-y-7" data-testid="settings-dialog">
      <section class="space-y-4">
        <h3 class="text-sm font-semibold">{{ t('settings.defaults') }}</h3>

        <div class="grid gap-4 sm:grid-cols-2">
          <div class="space-y-1.5">
            <Label for="pref-image-format">{{ t('settings.imageFormat') }}</Label>
            <Select
              id="pref-image-format"
              :model-value="settings.preferences.imageFormat"
              :options="imageFormats"
              @update:model-value="settings.update({ imageFormat: String($event) })"
            />
          </div>

          <div class="space-y-1.5">
            <Label for="pref-image-quality">
              {{ t('settings.imageQuality') }}
              <span class="numeric ms-1 text-muted-foreground">{{ settings.preferences.imageQuality }}</span>
            </Label>
            <Range
              id="pref-image-quality"
              :model-value="settings.preferences.imageQuality"
              :min="1"
              :max="100"
              @update:model-value="settings.update({ imageQuality: Number($event) })"
            />
          </div>

          <div class="space-y-1.5">
            <Label for="pref-audio-format">{{ t('settings.audioFormat') }}</Label>
            <Select
              id="pref-audio-format"
              :model-value="settings.preferences.audioFormat"
              :options="audioFormats"
              @update:model-value="settings.update({ audioFormat: String($event) })"
            />
          </div>

          <div class="space-y-1.5">
            <Label for="pref-audio-bitrate">{{ t('settings.audioBitrate') }}</Label>
            <Select
              id="pref-audio-bitrate"
              :model-value="settings.preferences.audioBitrate"
              :options="bitrates"
              @update:model-value="settings.update({ audioBitrate: Number($event) })"
            />
          </div>

          <div class="space-y-1.5">
            <Label for="pref-video-format">{{ t('settings.videoFormat') }}</Label>
            <Select
              id="pref-video-format"
              :model-value="settings.preferences.videoFormat"
              :options="videoFormats"
              @update:model-value="settings.update({ videoFormat: String($event) })"
            />
          </div>

          <div class="space-y-1.5">
            <Label for="pref-video-quality">{{ t('settings.videoQuality') }}</Label>
            <Select
              id="pref-video-quality"
              :model-value="settings.preferences.videoPreset"
              :options="qualityPresets"
              @update:model-value="settings.update({ videoPreset: $event as QualityPreset })"
            />
          </div>
        </div>

        <div class="space-y-1.5">
          <Label>{{ t('settings.videoEngine') }}</Label>
          <SegmentedControl
            :model-value="settings.preferences.videoEngine"
            :options="engines"
            :label="t('settings.videoEngine')"
            @update:model-value="settings.update({ videoEngine: $event as Engine })"
          />
          <p class="text-xs text-muted-foreground">{{ t('file.serverHint') }}</p>
        </div>

        <Alert v-if="!system.serverAvailable && !system.loading" tone="warning" :message="t('settings.serverUnavailable')" />
      </section>

      <section class="space-y-4 border-t border-border pt-5">
        <h3 class="text-sm font-semibold">{{ t('settings.behaviour') }}</h3>
        <label class="flex items-center justify-between gap-4">
          <span class="space-y-0.5">
            <span class="block text-sm font-medium">{{ t('settings.autoDownload') }}</span>
            <span class="block text-xs text-muted-foreground">{{ t('settings.autoDownloadHint') }}</span>
          </span>
          <Switch
            :model-value="settings.preferences.autoDownload"
            :label="t('settings.autoDownload')"
            @update:model-value="settings.update({ autoDownload: $event })"
          />
        </label>
      </section>

      <section class="space-y-3 border-t border-border pt-5 text-sm">
        <h3 class="font-semibold">{{ t('settings.about') }}</h3>
        <p class="text-muted-foreground">{{ t('settings.aboutText') }}</p>
        <dl class="grid gap-2 sm:grid-cols-2">
          <div class="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2">
            <dt class="text-muted-foreground">{{ t('settings.version') }}</dt>
            <dd class="numeric font-mono text-xs">{{ system.version }}</dd>
          </div>
          <div class="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2">
            <dt class="text-muted-foreground">{{ t('settings.engine') }}</dt>
            <dd class="numeric break-anywhere text-end font-mono text-xs">
              {{ system.health?.ffmpeg_version || t('settings.engineMissing') }}
            </dd>
          </div>
        </dl>
        <p class="text-xs text-muted-foreground">{{ t('settings.storage') }}</p>
      </section>
    </div>

    <template #footer>
      <Button variant="outline" @click="settings.reset()">
        <RotateCcw class="h-4 w-4" aria-hidden="true" />
        {{ t('settings.reset') }}
      </Button>
      <Button @click="open = false">{{ t('common.close') }}</Button>
    </template>
  </Dialog>
</template>
