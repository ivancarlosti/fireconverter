// Application bootstrap.
//
// Order matters: the theme and language are applied before the first paint, the
// global error handler routes unexpected failures to the toast stack, and the
// server capabilities load in the background so the dropzone is usable
// immediately.
import { createPinia } from 'pinia';
import { createApp } from 'vue';

import App from '@/App.vue';
import { i18n, initLocale } from '@/i18n';
import { useFeedbackStore } from '@/stores/feedback';
import { useThemeStore } from '@/stores/theme';

import '@/style.css';

const pinia = createPinia();
const app = createApp(App);

app.use(pinia);
app.use(i18n);

const theme = useThemeStore(pinia);
theme.init();
initLocale();

app.config.errorHandler = (error, _instance, info) => {
  console.error('unhandled UI error', error, info);
  const feedback = useFeedbackStore(pinia);
  feedback.fail(i18n.global.t('errors.generic'), error instanceof Error ? error.message : String(error));
};

app.mount('#app');
