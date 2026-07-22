import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import mkcert from 'vite-plugin-mkcert'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  server: {
    host: true,
  },
  plugins: [
    react(),
    tailwindcss(),
    mkcert(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['pwa-192x192.png', 'pwa-512x512.png'],
      manifest: {
        name: 'VoiceTrack',
        short_name: 'VoiceTrack',
        description: 'Tracciamento calorico e macro a voce',
        theme_color: '#121613',
        background_color: '#121613',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        shortcuts: [
          {
            name: 'Traccia',
            short_name: 'Traccia',
            url: '/?action=voice',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
          },
          {
            name: 'Scansiona',
            short_name: 'Scansiona',
            url: '/?action=scan',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
          },
        ],
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
})
