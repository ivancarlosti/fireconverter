<script setup lang="ts">
// TargetPlanDialog — the review step before a target-size encode.
import { Image as ImageIcon, Music, Video } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import Alert from '@/components/ui/Alert.vue';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import Dialog from '@/components/ui/Dialog.vue';
import { formatBytes, formatDuration, formatNumber } from '@/lib/format';
import { useConverterStore } from '@/stores/converter';

const store = useConverterStore();
const { t, locale } = useI18n();

const current = computed(() => store.activePlan);
const item = computed(() => store.files.find((candidate) => candidate.id === current.value?.itemId));
const plan = computed(() => current.value?.plan);
const open = computed({
  get: () => current.value !== null,
  set: (value: boolean) => {
    if (!value) store.dismissPlans();
  },
});

const icon = computed(() => {
  if (current.value?.kind === 'image') return ImageIcon;
  if (current.value?.kind === 'audio') return Music;
  return Video;
});

const targetBytes = computed(() => (current.value?.targetMB ?? 0) * 1_000_000);
const resolution = computed(() => {
  if (!plan.value) return '';
  if (plan.value.scale) return plan.value.scale;
  if (plan.value.width && plan.value.height) {
    return `${plan.value.width} × ${plan.value.height}`;
  }
  return '';
});

const warnings = computed(() => plan.value?.warnings ?? []);

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
</script>

<template>
  <Dialog
    v-model:open="open"
    :title="t('target.title')"
    :description="current ? t('target.description', { name: current.itemName }) : ''"
    size="md"
    :close-label="t('common.close')"
  >
    <div v-if="current" class="space-y-5" data-testid="plan-dialog">
      <div class="flex items-start gap-3">
        <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <component :is="icon" class="h-5 w-5" aria-hidden="true" />
        </span>
        <div class="min-w-0 space-y-1">
          <p class="break-anywhere text-sm font-medium">{{ current.itemName }}</p>
          <div class="flex flex-wrap items-center gap-1.5">
            <Badge tone="secondary">{{ t(`kind.${current.kind}`) }}</Badge>
            <Badge tone="outline">{{ item?.settings.format.toUpperCase() }}</Badge>
            <Badge :tone="item?.settings.engine === 'server' ? 'default' : 'success'">
              {{ item?.settings.engine === 'server' ? t('file.server') : t('file.local') }}
            </Badge>
          </div>
        </div>
        <div class="ms-auto text-end">
          <p class="text-xs uppercase tracking-wide text-muted-foreground">{{ t('target.cap') }}</p>
          <p class="numeric text-2xl font-semibold">{{ formatBytes(targetBytes, locale) }}</p>
        </div>
      </div>

      <Alert tone="info">
        <template #title>{{ t('target.hardCap') }}</template>
        <p v-if="current.kind === 'image'">{{ t('target.imageNote', { size: formatBytes(targetBytes, locale) }) }}</p>
        <p v-else-if="current.kind === 'audio'">{{ t('target.audioNote', { size: formatBytes(targetBytes, locale) }) }}</p>
        <p v-else-if="item?.settings.engine === 'local'">{{ t('target.localVideoNote') }}</p>
        <p v-else>{{ t('target.videoNote') }}</p>
      </Alert>

      <dl v-if="plan" class="grid gap-2 sm:grid-cols-2">
        <div class="rounded-lg border border-border bg-muted/30 p-3">
          <dt class="text-xs text-muted-foreground">{{ t('target.duration') }}</dt>
          <dd class="numeric text-sm font-medium">{{ formatDuration(plan.duration_seconds) }}</dd>
        </div>
        <div v-if="resolution" class="rounded-lg border border-border bg-muted/30 p-3">
          <dt class="text-xs text-muted-foreground">{{ t('target.resolution') }}</dt>
          <dd class="numeric text-sm font-medium">{{ resolution }}</dd>
        </div>
        <div v-if="plan.video_bitrate_kbps" class="rounded-lg border border-border bg-muted/30 p-3">
          <dt class="text-xs text-muted-foreground">{{ t('target.videoBitrate') }}</dt>
          <dd class="numeric text-sm font-medium">{{ formatNumber(plan.video_bitrate_kbps, locale) }} kbps</dd>
        </div>
        <div v-if="plan.audio_bitrate_kbps" class="rounded-lg border border-border bg-muted/30 p-3">
          <dt class="text-xs text-muted-foreground">{{ t('target.audioBitrate') }}</dt>
          <dd class="numeric text-sm font-medium">{{ formatNumber(plan.audio_bitrate_kbps, locale) }} kbps</dd>
        </div>
        <div class="rounded-lg border border-border bg-muted/30 p-3">
          <dt class="text-xs text-muted-foreground">{{ t('target.estimated') }}</dt>
          <dd class="numeric text-sm font-medium">{{ formatBytes(plan.estimated_bytes, locale) }}</dd>
        </div>
        <div class="rounded-lg border border-border bg-muted/30 p-3">
          <dt class="text-xs text-muted-foreground">{{ t('target.passes') }}</dt>
          <dd class="numeric text-sm font-medium">{{ plan.passes }}</dd>
        </div>
      </dl>

      <ul v-if="warnings.length" class="space-y-2">
        <li v-for="warning in warnings" :key="warning">
          <Alert tone="warning" :message="warningLabel(warning)" />
        </li>
      </ul>
    </div>

    <template #footer>
      <Button variant="outline" @click="store.dismissPlans()">{{ t('common.cancel') }}</Button>
      <Button
        v-if="store.planQueue.length > 1"
        variant="secondary"
        @click="store.confirmAllPlans()"
      >
        {{ t('target.confirmAll', { count: store.planQueue.length }) }}
      </Button>
      <Button @click="store.confirmCurrentPlan()">{{ t('target.start') }}</Button>
    </template>
  </Dialog>
</template>
