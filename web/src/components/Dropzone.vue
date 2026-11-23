<script setup lang="ts">
// Dropzone — drag and drop plus a keyboard-accessible file picker.
import { Flame, UploadCloud } from '@lucide/vue';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { acceptAttribute } from '@/lib/formats';
import { cn } from '@/lib/utils';

const props = withDefaults(
  defineProps<{
    maxFiles?: number;
    disabled?: boolean;
  }>(),
  { maxFiles: 50 },
);

const emit = defineEmits<{ files: [files: File[]] }>();
const { t } = useI18n();
const input = ref<HTMLInputElement | null>(null);
const dragging = ref(false);
let depth = 0;

function open(): void {
  if (!props.disabled) input.value?.click();
}

function onChange(event: Event): void {
  const target = event.target as HTMLInputElement;
  const files = target.files ? [...target.files] : [];
  target.value = '';
  if (files.length) emit('files', files);
}

function onDragEnter(event: DragEvent): void {
  event.preventDefault();
  if (props.disabled) return;
  depth += 1;
  dragging.value = true;
}

function onDragOver(event: DragEvent): void {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
}

function onDragLeave(event: DragEvent): void {
  event.preventDefault();
  depth = Math.max(0, depth - 1);
  if (depth === 0) dragging.value = false;
}

function onDrop(event: DragEvent): void {
  event.preventDefault();
  depth = 0;
  dragging.value = false;
  if (props.disabled) return;
  const files = event.dataTransfer?.files ? [...event.dataTransfer.files] : [];
  if (files.length) emit('files', files);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    open();
  }
}
</script>

<template>
  <div
    role="button"
    tabindex="0"
    :aria-label="t('a11y.dropzone')"
    :aria-disabled="disabled || undefined"
    :class="
      cn(
        'flame-glow group relative flex cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-border bg-card/70 px-6 py-12 text-center transition-colors hover:border-primary/60 hover:bg-card',
        dragging && 'dropzone-active',
        disabled && 'pointer-events-none opacity-60',
      )
    "
    @click="open"
    @keydown="onKeydown"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <input
      ref="input"
      type="file"
      multiple
      class="sr-only"
      :accept="acceptAttribute()"
      :disabled="disabled"
      data-testid="file-input"
      @change="onChange"
    />

    <span
      class="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 via-orange-500 to-red-600 text-white shadow-lg shadow-orange-500/20"
    >
      <Flame v-if="dragging" class="h-8 w-8" aria-hidden="true" />
      <UploadCloud v-else class="h-8 w-8" aria-hidden="true" />
    </span>

    <div class="space-y-1">
      <p class="text-lg font-semibold tracking-tight">
        {{ dragging ? t('upload.dragActive') : t('upload.title') }}
      </p>
      <p class="text-sm text-muted-foreground">{{ t('upload.subtitle') }}</p>
    </div>

    <span
      class="inline-flex h-10 items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground shadow-sm transition-colors group-hover:bg-primary/90"
    >
      {{ t('upload.browse') }}
    </span>

    <div class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span>{{ t('upload.privacy') }}</span>
      <span aria-hidden="true">·</span>
      <span>{{ t('upload.maxFiles', { count: maxFiles }) }}</span>
    </div>
  </div>
</template>
