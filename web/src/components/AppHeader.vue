<script setup lang="ts">
// AppHeader — brand, privacy badge and the three global controls.
import { Settings } from '@lucide/vue';
import { useI18n } from 'vue-i18n';

import LanguageSwitcher from '@/components/LanguageSwitcher.vue';
import ThemeToggle from '@/components/ThemeToggle.vue';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';

const emit = defineEmits<{ settings: [] }>();
const { t } = useI18n();
</script>

<template>
  <header class="sticky top-0 z-40 w-full border-b border-border bg-background/95 backdrop-blur">
    <div class="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-5">
      <a href="/" class="flex items-center gap-2 rounded-md pe-2 font-semibold">
        <img src="/logo.svg" alt="" class="h-8 w-8" />
        <span class="text-base tracking-tight">{{ t('app.name') }}</span>
      </a>
      <Badge tone="success" class="hidden sm:inline-flex">
        <span class="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
        {{ t('app.privacyShort') }}
      </Badge>

      <div class="ms-auto flex items-center gap-1">
        <Button variant="ghost" size="icon" :aria-label="t('nav.settings')" @click="emit('settings')">
          <Settings class="h-4 w-4" aria-hidden="true" />
        </Button>
        <LanguageSwitcher />
        <ThemeToggle />
      </div>
    </div>
  </header>
</template>
