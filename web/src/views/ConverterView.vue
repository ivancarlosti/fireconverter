<script setup lang="ts">
// ConverterView — the single screen of the app.
import {
  Cpu,
  Download,
  Flame,
  HardDrive,
  Image as ImageIcon,
  Music,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Video,
} from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import Dropzone from '@/components/Dropzone.vue';
import FileCard from '@/components/FileCard.vue';
import Alert from '@/components/ui/Alert.vue';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import { formatBytes } from '@/lib/format';
import { useConverterStore } from '@/stores/converter';
import { useSystemStore } from '@/stores/system';

const emit = defineEmits<{ settings: [] }>();
const { t, locale } = useI18n();
const converter = useConverterStore();
const system = useSystemStore();

const features = computed(() => [
  { icon: ImageIcon, title: t('privacy.imageTitle'), body: t('privacy.imageBody') },
  { icon: Music, title: t('privacy.audioTitle'), body: t('privacy.audioBody') },
  { icon: Video, title: t('privacy.videoTitle'), body: t('privacy.videoBody') },
]);

function onFiles(files: File[]): void {
  void converter.addFiles(files);
}
</script>

<template>
  <div class="mx-auto w-full max-w-6xl space-y-6 px-5 py-8">
    <section class="space-y-4">
      <div class="flex flex-wrap items-center gap-2">
        <Badge tone="secondary">
          <Flame class="h-3 w-3" aria-hidden="true" />
          {{ t('app.tagline') }}
        </Badge>
        <Badge v-if="system.serverAvailable" tone="success">
          <Server class="h-3 w-3" aria-hidden="true" />
          {{ t('app.serverReady') }}
        </Badge>
        <Badge v-else-if="!system.loading" tone="muted">
          <Cpu class="h-3 w-3" aria-hidden="true" />
          {{ t('app.localReady') }}
        </Badge>
      </div>

      <div class="grid items-end gap-4 md:grid-cols-[1fr_auto]">
        <div class="space-y-2">
          <h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">{{ t('hero.title') }}</h1>
          <p class="max-w-2xl text-base text-muted-foreground">{{ t('hero.subtitle') }}</p>
        </div>
        <Button variant="outline" @click="emit('settings')">
          <Settings class="h-4 w-4" aria-hidden="true" />
          {{ t('nav.settings') }}
        </Button>
      </div>

      <div class="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span class="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1">
          <ShieldCheck class="h-3.5 w-3.5 text-success" aria-hidden="true" />
          {{ t('hero.chipPrivate') }}
        </span>
        <span class="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1">
          <SlidersHorizontal class="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          {{ t('hero.chipTarget') }}
        </span>
        <span class="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1">
          <HardDrive class="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          {{ t('hero.chipNoAccount') }}
        </span>
      </div>
    </section>

    <Alert v-if="system.error" tone="warning" :title="t('errors.serverUnreachable')" :message="t('errors.serverUnreachableHint')" />

    <Dropzone :max-files="converter.maxFiles" @files="onFiles" />

    <section v-if="converter.files.length" class="space-y-4">
      <div class="flex flex-wrap items-center gap-2">
        <div class="flex items-center gap-2 text-sm">
          <span class="font-medium">{{ t('common.files', { count: converter.files.length }) }}</span>
          <span class="text-muted-foreground">·</span>
          <span class="numeric text-muted-foreground">{{ formatBytes(converter.totalSize, locale) }}</span>
          <Badge v-if="converter.doneCount" tone="success">
            {{ t('common.doneCount', { count: converter.doneCount }) }}
          </Badge>
        </div>

        <div class="ms-auto flex flex-wrap items-center gap-2">
          <Button v-if="converter.doneCount" variant="outline" size="sm" @click="converter.downloadAll()">
            <Download class="h-4 w-4" aria-hidden="true" />
            {{ t('common.downloadAll') }}
          </Button>
          <Button variant="outline" size="sm" :disabled="converter.doneCount === 0" @click="converter.clearFinished()">
            <Trash2 class="h-4 w-4" aria-hidden="true" />
            {{ t('common.clearDone') }}
          </Button>
          <Button variant="ghost" size="sm" :disabled="converter.hasActive" @click="converter.clearAll()">
            {{ t('common.clear') }}
          </Button>
          <Button
            :disabled="!converter.canConvertAll || converter.hasActive"
            :loading="converter.queueRunning"
            @click="converter.convertAll()"
          >
            <Flame class="h-4 w-4" aria-hidden="true" />
            {{ t('common.convertAll') }}
          </Button>
        </div>
      </div>

      <div class="grid gap-4 xl:grid-cols-2">
        <FileCard v-for="item in converter.files" :key="item.id" :item="item" />
      </div>
    </section>

    <section class="grid gap-3 pt-4 sm:grid-cols-3">
      <div v-for="feature in features" :key="feature.title" class="rounded-xl border border-border bg-card p-4">
        <span class="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <component :is="feature.icon" class="h-4 w-4" aria-hidden="true" />
        </span>
        <h2 class="text-sm font-semibold">{{ feature.title }}</h2>
        <p class="mt-1 text-xs text-muted-foreground">{{ feature.body }}</p>
      </div>
    </section>
  </div>
</template>
