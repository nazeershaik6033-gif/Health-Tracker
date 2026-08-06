import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Served from the domain root locally, but from `/<repo>/` on a GitHub Pages
 * project site. The deploy workflow sets BASE_PATH; leaving it unset keeps
 * `npm run dev` on a clean `/`.
 */
const base = process.env.BASE_PATH || '/';

/**
 * GitHub Pages has no SPA rewrite, so a deep link like `/diet` 404s. Pages
 * serves 404.html for unknown paths, so shipping a copy of index.html under
 * that name makes the router pick the route up instead.
 */
function spaFallback() {
  return {
    name: 'spa-404-fallback',
    closeBundle() {
      const dist = resolve(fileURLToPath(new URL('./dist', import.meta.url)));
      copyFileSync(resolve(dist, 'index.html'), resolve(dist, '404.html'));
    },
  };
}

export default defineConfig({
  base,
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // injectManifest so we own the service worker and can handle the
      // share_target POST (Workbox's generateSW can't express that).
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,json}'],
        // The zxing wasm binary and tesseract worker are lazy-loaded; keep
        // them out of the precache so first install stays small.
        globIgnores: ['**/*.wasm', '**/tesseract*'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: { enabled: false, type: 'module' },
      manifest: {
        name: 'Healthify — AI Health Tracker',
        short_name: 'Healthify',
        description:
          'Track calories with a photo, barcode or your voice. Log meals, water, sleep, weight and workouts, with an AI nutrition and fitness coach.',
        // Relative so they resolve against the manifest's own URL — correct
        // at the domain root and under a Pages project sub-path alike.
        start_url: '.',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F7F7F5',
        theme_color: '#14A06A',
        categories: ['health', 'fitness', 'lifestyle'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        shortcuts: [
          { name: 'Snap a meal', url: 'snap', description: 'Track calories from a photo' },
          { name: 'Scan barcode', url: 'scan', description: 'Scan a packaged food' },
          { name: 'Ask Ria', url: 'coach', description: 'Chat with your AI coach' },
        ],
        // Share-to-track: the web-native stand-in for gallery auto-detect.
        // Sharing a photo from the gallery opens Healthify and analyses it.
        share_target: {
          action: 'share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            files: [
              {
                name: 'photos',
                accept: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/*'],
              },
            ],
          },
        },
      },
    }),
    spaFallback(),
  ],
});
