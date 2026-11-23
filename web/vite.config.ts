// Vite configuration for the FireConverter SPA.
//
// The build lands in `web/dist`, which `web/embed.go` embeds with
// `//go:embed all:dist`, so the Go runtime serves the SPA without Node.
// In development `/api` is proxied to the Go server, keeping every request on
// one origin (no CORS, no cookies).
import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_');
  const apiTarget = env.VITE_DEV_API ?? 'http://127.0.0.1:3000';

  return {
    plugins: [vue(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    // @ffmpeg/ffmpeg spawns its own worker; pre-bundling the package breaks the
    // worker URL. Excluding both packages keeps dev and build identical.
    optimizeDeps: {
      exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/core'],
    },
    worker: {
      format: 'es',
    },
    build: {
      outDir: 'dist',
      // A stale asset from a previous build would be embedded into the binary.
      emptyOutDir: true,
      assetsDir: 'assets',
      sourcemap: false,
      chunkSizeWarningLimit: 1200,
    },
    server: {
      port: 5173,
      proxy: {
        '/api': { target: apiTarget, changeOrigin: false },
      },
    },
    preview: {
      port: 4173,
    },
  };
});
