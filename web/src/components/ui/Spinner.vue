<script setup lang="ts">
// Spinner — an inline progress indicator.
import { LoaderCircle } from '@lucide/vue';

import { cn } from '@/lib/utils';

withDefaults(
  defineProps<{
    size?: 'sm' | 'default' | 'lg';
    label?: string;
    class?: string;
  }>(),
  { size: 'default' },
);
</script>

<template>
  <span role="status" :aria-label="label" :class="cn('inline-flex items-center justify-center', $props.class)">
    <LoaderCircle
      :class="
        cn(
          'animate-spin text-muted-foreground',
          size === 'sm' && 'h-3.5 w-3.5',
          size === 'default' && 'h-5 w-5',
          size === 'lg' && 'h-8 w-8',
        )
      "
      aria-hidden="true"
    />
    <span v-if="label" class="sr-only">{{ label }}</span>
  </span>
</template>
