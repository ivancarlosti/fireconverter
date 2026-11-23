// Transient feedback (toast) store.
import { defineStore } from 'pinia';
import { ref } from 'vue';

export type FeedbackTone = 'success' | 'error' | 'info';

export interface Feedback {
  id: number;
  tone: FeedbackTone;
  message: string;
  detail?: string;
}

const AUTO_DISMISS_MS: Record<FeedbackTone, number> = {
  success: 6000,
  info: 8000,
  error: 15000,
};

export const useFeedbackStore = defineStore('feedback', () => {
  const items = ref<Feedback[]>([]);
  let sequence = 0;

  function dismiss(id: number): void {
    items.value = items.value.filter((item) => item.id !== id);
  }

  function push(tone: FeedbackTone, message: string, detail?: string): number {
    sequence += 1;
    const id = sequence;
    items.value = [...items.value, { id, tone, message, detail: detail || undefined }];
    window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS[tone]);
    return id;
  }

  const success = (message: string): number => push('success', message);
  const info = (message: string): number => push('info', message);
  const fail = (message: string, detail?: string): number => push('error', message, detail);

  function clear(): void {
    items.value = [];
  }

  return { items, push, success, info, fail, dismiss, clear };
});
