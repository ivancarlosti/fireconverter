<script setup lang="ts">
// Range — a native range input styled with the app tokens.
import { cn } from '@/lib/utils';

withDefaults(
  defineProps<{
    id?: string;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
    label?: string;
    class?: string;
  }>(),
  { min: 0, max: 100, step: 1 },
);

const model = defineModel<number>({ default: 0 });
</script>

<template>
  <input
    :id="id"
    v-model.number="model"
    type="range"
    :min="min"
    :max="max"
    :step="step"
    :disabled="disabled"
    :aria-label="label"
    :class="cn('h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary disabled:cursor-not-allowed disabled:opacity-50', $props.class)"
  />
</template>
