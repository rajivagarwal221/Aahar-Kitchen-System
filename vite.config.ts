import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'recipes.json', 'sample-cgm.csv'],
      manifest: {
        name: 'AHAAR Kitchen System',
        short_name: 'AHAAR',
        description: 'Open the fridge. Know what\'s for dinner.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#FBF6EC',
        theme_color: '#3F6B3A',
        lang: 'en-IN',
        categories: ['food', 'health', 'lifestyle', 'utilities'],
        icons: [
          { src: 'favicon.svg', sizes: 'any',      type: 'image/svg+xml', purpose: 'any' },
          { src: 'favicon.svg', sizes: 'any',      type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the built shell + the two static data assets that
        // AHAAR can meaningfully use offline. ONNX model + detection API
        // stay network-only (too big / require the FastAPI backend).
        globPatterns: ['**/*.{js,css,html,svg,woff2,json,csv}'],
        globIgnores: ['**/node_modules/**', 'sw.js', 'workbox-*.js'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [
          // Never serve index.html for the FastAPI backend calls.
          /^\/detect/, /^\/recipes\//, /^\/nutrition\//, /^\/api\//, /^\/health$/,
        ],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith('/recipes.json') || url.pathname.endsWith('/sample-cgm.csv'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'ahaar-data-v1',
              expiration: { maxEntries: 8, maxAgeSeconds: 30 * 24 * 3600 },
            },
          },
          {
            // Recipe source links the UI exposes — open successfully even offline.
            urlPattern: ({ url }) => /\.(?:png|jpg|jpeg|svg|webp)$/i.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'ahaar-images-v1',
              expiration: { maxEntries: 60, maxAgeSeconds: 30 * 24 * 3600 },
            },
          },
        ],
      },
    }),
  ],
  server: { host: true, port: 5173 },
});
