import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { target: 'es2020', sourcemap: true },
  worker: { format: 'es' },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'og-image.png'],
      manifest: {
        id: '/',
        name: 'Drop Four',
        short_name: 'Drop Four',
        description: 'Four-in-a-row: pass & play, a 5-level AI, and online rooms.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f5f1e8',
        theme_color: '#2b3a8f',
        categories: ['games'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Play vs AI', url: '/?mode=ai', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        // Firebase chunks are excluded from precache: online mode needs the network anyway.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        globIgnores: ['**/firebase-*.js', '**/og-image.png'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/assets/firebase-'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'firebase-sdk', expiration: { maxEntries: 10 } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
});
