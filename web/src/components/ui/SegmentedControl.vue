<script setup lang="ts">
// SegmentedControl — an accessible radio group rendered as a segmented bar.
import type { Component } from 'vue';

import { cn } from '@/lib/utils';

export interface SegmentOption {
  value: string;
  label: string;
  icon?: Component;
  disabled?: boolean;
}

const props = withDefaults(
  defineProps<{
    options: SegmentOption[];
    label: string;
    disabled?: boolean;
    class?: string;
    size?: 'sm' | 'default';
  }>(),
  { size: 'default' },
);

const model = defineModel<string>({ required: true });

function choose(value: string, disabled?: boolean): void {
  if (!props.disabled && !disabled) model.value = value;
}
</script>

<template>
  <div
    role="radiogroup"
    :aria-label="label"
    :class="
      cn(
        'inline-flex w-full items-center rounded-lg bg-muted p-1 text-muted-foreground',
        $props.class,
      )
    "
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="radio"
      :aria-checked="model === option.value"
      :disabled="disabled || option.disabled"
      :class="
        cn(
          'inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm',
          model === option.value
            ? 'bg-background text-foreground shadow-sm'
            : 'hover:text-foreground',
        )
      "
      @click="choose(option.value, option.disabled)"
    >
      <component :is="option.icon" v-if="option.icon" class="h-3.5 w-3.5" aria-hidden="true" />
      {{ option.label }}
    </button>
  </div>
</template>
