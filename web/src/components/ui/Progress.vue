<script setup lang="ts">
// Progress — a determinate bar with an accessible name.
import { computed } from 'vue';

import { cn } from '@/lib/utils';

const props = withDefaults(
  defineProps<{
    value: number;
    label?: string;
    tone?: 'primary' | 'success' | 'warning';
    class?: string;
  }>(),
  { tone: 'primary' },
);

const percent = computed(() => Math.min(100, Math.max(0, props.value)));
const toneClass = computed(
  () =>
    ({
      primary: 'bg-primary',
      success: 'bg-success',
      warning: 'bg-warning',
    })[props.tone],
);
</script>

<template>
  <div
    role="progressbar"
    :aria-label="label"
    :aria-valuemin="0"
    :aria-valuemax="100"
    :aria-valuenow="Math.round(percent)"
    :class="cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', $props.class)"
  >
    <div
      :class="cn('h-full rounded-full transition-[width] duration-200', toneClass)"
      :style="{ width: `${percent}%` }"
    />
  </div>
</template>
