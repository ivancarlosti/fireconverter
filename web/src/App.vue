<script setup lang="ts">
// App root: header, the single converter screen, footer and global overlays.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import AppHeader from '@/components/AppHeader.vue';
import AppToaster from '@/components/AppToaster.vue';
import SettingsDialog from '@/components/SettingsDialog.vue';
import TargetPlanDialog from '@/components/TargetPlanDialog.vue';
import ConverterView from '@/views/ConverterView.vue';
import { useConverterStore } from '@/stores/converter';
import { useSystemStore } from '@/stores/system';

const { t } = useI18n();
const system = useSystemStore();
const converter = useConverterStore();
const settingsOpen = ref(false);

const version = computed(() => system.version);
const commit = computed(() => system.health?.version.commit ?? '');

function beforeUnload(event: BeforeUnloadEvent): void {
  if (!converter.hasActive) return;
  event.preventDefault();
  event.returnValue = '';
}

onMounted(() => {
  void system.load();
  window.addEventListener('beforeunload', beforeUnload);
});

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', beforeUnload);
});
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <a
      href="#content"
      class="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-1.5 focus:text-sm focus:text-primary-foreground"
    >
      {{ t('nav.skipToContent') }}
    </a>

    <AppHeader @settings="settingsOpen = true" />

    <main id="content" class="w-full flex-1">
      <ConverterView @settings="settingsOpen = true" />
    </main>

    <footer class="border-t border-border py-5">
      <div class="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-5 text-xs text-muted-foreground">
        <span>{{ t('footer.local') }}</span>
        <span class="numeric">
          {{ t('footer.version', { version }) }}
          <template v-if="commit && commit !== 'unknown'"> · {{ commit.slice(0, 7) }}</template>
        </span>
      </div>
    </footer>

    <SettingsDialog v-model:open="settingsOpen" />
    <TargetPlanDialog />
    <AppToaster />
  </div>
</template>
