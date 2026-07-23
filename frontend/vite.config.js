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
        // Scope assoluto: con base './' il plugin metteva scope './' e Android
        // a volte non registrava share_target.
        start_url: '/',
        scope: '/',
        // Pressione lunga icona (WebAPK): stesse azioni rapide del Diario.
        // Ordine = piano §7.3 Traccia/Scansiona prima, poi Cerca/Testo.
        shortcuts: [
          {
            name: 'Traccia',
            short_name: 'Traccia',
            description: 'Registra un pasto a voce',
            url: '/?action=voice',
            icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Scansiona',
            short_name: 'Scansiona',
            description: 'Inquadra un codice a barre',
            url: '/?action=scan',
            icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Cerca',
            short_name: 'Cerca',
            description: 'Cerca nel catalogo o su Open Food Facts',
            url: '/?action=cerca',
            icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Testo',
            short_name: 'Testo',
            description: 'Registra un pasto digitando',
            url: '/?action=text',
            icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
        // Path senza query nell'action: Chrome/Android spesso ignora share_target
        // se action contiene già '?…'. Params GET vengono appesi da Android.
        share_target: {
          action: '/share-off',
          method: 'GET',
          enctype: 'application/x-www-form-urlencoded',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
          },
        },
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
})
