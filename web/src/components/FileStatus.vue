<script setup lang="ts">
// FileStatus — progress, failure, result and the actions of one file.
import { Download, RefreshCw, RotateCcw, SlidersHorizontal, Square } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import Alert from '@/components/ui/Alert.vue';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import Progress from '@/components/ui/Progress.vue';
import { formatBytes, formatPercent } from '@/lib/format';
import type { FileItem } from '@/lib/types';
import { useConverterStore } from '@/stores/converter';

const props = defineProps<{ item: FileItem; adjustOpen: boolean }>();
const emit = defineEmits<{ adjust: [] }>();
const store = useConverterStore();
const { t, locale } = useI18n();

const active = computed(
  () =>
    props.item.status === 'uploading' ||
    props.item.status === 'awaiting' ||
    props.item.status === 'queued' ||
    props.item.status === 'converting',
);
const done = computed(() => props.item.status === 'done');
const failed = computed(() => props.item.status === 'error');
const canceled = computed(() => props.item.status === 'canceled');

const stageText = computed(() => t(`status.${props.item.stage}`));
const errorText = computed(() => t(`errors.${props.item.errorCode ?? 'generic'}`));

const savings = computed(() => {
  if (!props.item.result) return null;
  return (props.item.size - props.item.result.size) / Math.max(1, props.item.size);
});

const warningCodes = computed(() => props.item.warnings);

function warningLabel(code: string): string {
  switch (code) {
    case 'target_larger_than_source':
      return t('target.warnLarger');
    case 'bitrate_very_high':
      return t('target.warnHigh');
    case 'target_above_codec_max':
      return t('target.warnAboveMax');
    case 'target_retried':
      return t('target.warnRetried');
    default:
      return code;
  }
}

function convert(): void {
  void store.convertFile(props.item.id);
}

function cancel(): void {
  void store.cancelFile(props.item.id);
}

function download(): void {
  void store.downloadFile(props.item.id);
}
</script>

<template>
  <div class="space-y-3 border-t border-border p-4">
    <div v-if="active" class="space-y-2">
      <div class="flex items-center justify-between gap-3 text-sm">
        <span class="flex items-center gap-2 font-medium">
          <RefreshCw class="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
          {{ stageText }}
        </span>
        <span class="numeric text-xs text-muted-foreground">{{ Math.round(item.progress) }}%</span>
      </div>
      <Progress :value="item.progress" :label="t('a11y.progress', { name: item.name })" />
      <div class="flex justify-end">
        <Button variant="outline" size="sm" @click="cancel">
          <Square class="h-3.5 w-3.5" aria-hidden="true" />
          {{ item.status === 'awaiting' ? t('target.cancelReview') : t('file.cancel') }}
        </Button>
      </div>
    </div>

    <Alert v-else-if="failed" tone="destructive" :title="errorText" :message="item.errorMessage || t('errors.generic')">
      <template #footer>
        <div class="flex flex-wrap gap-2 pt-1">
          <Button variant="outline" size="sm" @click="convert">
            <RotateCcw class="h-3.5 w-3.5" aria-hidden="true" />
            {{ t('common.retry') }}
          </Button>
        </div>
      </template>
    </Alert>

    <div v-else-if="done && item.result" class="space-y-3">
      <div class="flex flex-wrap items-center gap-2">
        <Badge tone="success">{{ t('file.result') }}</Badge>
        <span class="break-anywhere min-w-0 flex-1 text-sm font-medium">{{ item.result.name }}</span>
        <span class="numeric text-sm text-muted-foreground">{{ formatBytes(item.result.size, locale) }}</span>
        <Badge v-if="savings !== null && savings >= 0" tone="success">
          {{ t('file.saved', { percent: formatPercent(savings, locale) }) }}
        </Badge>
        <Badge v-else-if="savings !== null" tone="warning">
          {{ t('file.larger', { percent: formatPercent(Math.abs(savings), locale) }) }}
        </Badge>
      </div>
      <p class="text-xs text-muted-foreground">
        {{ item.result.engine === 'server' ? t('file.engineServer') : t('file.engineLocal') }}
        <template v-if="item.settings.mode === 'target'">
          · {{ t('file.targetResult', { target: `${item.settings.targetMB} MB` }) }}
        </template>
      </p>
      <div class="flex flex-wrap gap-2">
        <Button size="sm" data-testid="download-button" @click="download">
          <Download class="h-4 w-4" aria-hidden="true" />
          {{ t('common.download') }}
        </Button>
        <Button variant="outline" size="sm" @click="store.convertAgain(item.id)">
          <RefreshCw class="h-3.5 w-3.5" aria-hidden="true" />
          {{ t('file.convertAgain') }}
        </Button>
        <Button variant="ghost" size="sm" @click="emit('adjust')">
          <SlidersHorizontal class="h-4 w-4" aria-hidden="true" />
          {{ adjustOpen ? t('file.hideSettings') : t('file.adjustSettings') }}
        </Button>
      </div>
    </div>

    <div v-else class="flex flex-wrap items-center gap-2">
      <Button size="sm" data-testid="convert-button" @click="convert">
        <RefreshCw class="h-3.5 w-3.5" aria-hidden="true" />
        {{ canceled ? t('common.retry') : t('common.convert') }}
      </Button>
      <span v-if="canceled" class="text-xs text-muted-foreground">{{ t('file.canceledHint') }}</span>
    </div>

    <ul v-if="warningCodes.length" class="space-y-1">
      <li v-for="code in warningCodes" :key="code" class="text-xs text-warning">
        {{ warningLabel(code) }}
      </li>
    </ul>
  </div>
</template>
