<script setup lang="ts">
// FileCard — the shell of one queued file. Settings and status live in their
// own components so each concern stays readable.
import { Image as ImageIcon, Music, Video, X } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import FileSettings from '@/components/FileSettings.vue';
import FileStatus from '@/components/FileStatus.vue';
import Badge from '@/components/ui/Badge.vue';
import { formatBytes, formatDuration } from '@/lib/format';
import type { FileItem } from '@/lib/types';
import { useConverterStore } from '@/stores/converter';

const props = defineProps<{ item: FileItem }>();
const store = useConverterStore();
const { t, locale } = useI18n();
const adjustOpen = ref(false);

const active = computed(
  () =>
    props.item.status === 'uploading' ||
    props.item.status === 'awaiting' ||
    props.item.status === 'queued' ||
    props.item.status === 'converting',
);
const done = computed(() => props.item.status === 'done');
const showSettings = computed(() => !active.value && (!done.value || adjustOpen.value));

const kindIcon = computed(() => {
  if (props.item.kind === 'image') return ImageIcon;
  if (props.item.kind === 'audio') return Music;
  return Video;
});

const statusLabel = computed(() => {
  if (props.item.status === 'converting') return t(`status.${props.item.stage}`);
  return t(`status.${props.item.status}`);
});

const statusTone = computed(() => {
  switch (props.item.status) {
    case 'done':
      return 'success';
    case 'error':
      return 'destructive';
    case 'canceled':
      return 'warning';
    case 'ready':
      return 'muted';
    default:
      return 'default';
  }
});

const dimensions = computed(() => {
  const width = props.item.result?.width ?? props.item.probe?.width;
  const height = props.item.result?.height ?? props.item.probe?.height;
  return width && height ? `${width} × ${height}` : '';
});

const duration = computed(() =>
  formatDuration(props.item.result?.duration ?? props.item.probe?.duration ?? 0),
);
</script>

<template>
  <article class="overflow-hidden rounded-xl border border-border bg-card shadow-sm" data-testid="file-card">
    <div class="flex items-start gap-3 p-4">
      <div class="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
        <img v-if="item.previewUrl" :src="item.previewUrl" alt="" class="h-full w-full object-cover" />
        <component :is="kindIcon" v-else class="h-6 w-6" aria-hidden="true" />
      </div>

      <div class="min-w-0 flex-1 space-y-1">
        <div class="flex flex-wrap items-start gap-2">
          <p class="break-anywhere min-w-0 flex-1 text-sm font-medium">{{ item.name }}</p>
          <Badge :tone="statusTone">{{ statusLabel }}</Badge>
          <button
            type="button"
            class="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            :aria-label="t('common.removeFile', { name: item.name })"
            @click="store.removeFile(item.id)"
          >
            <X class="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <p class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>{{ t(`kind.${item.kind}`) }}</span>
          <span aria-hidden="true">·</span>
          <span class="numeric">{{ formatBytes(item.size, locale) }}</span>
          <template v-if="dimensions">
            <span aria-hidden="true">·</span>
            <span class="numeric">{{ dimensions }}</span>
          </template>
          <template v-if="item.probe?.duration">
            <span aria-hidden="true">·</span>
            <span class="numeric">{{ duration }}</span>
          </template>
          <template v-if="item.settings.mode === 'target'">
            <span aria-hidden="true">·</span>
            <span class="numeric">{{ t('file.targetBadge', { size: `${item.settings.targetMB} MB` }) }}</span>
          </template>
        </p>
      </div>
    </div>

    <FileSettings v-if="showSettings" :item="item" />

    <FileStatus :item="item" :adjust-open="adjustOpen" @adjust="adjustOpen = !adjustOpen" />
  </article>
</template>
