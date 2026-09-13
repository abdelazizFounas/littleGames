import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig, loadEnv } from 'vite';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  // Load every variable, not just the VITE_-prefixed ones, so the config can
  // reuse server-side values without re-declaring them.
  const env = loadEnv(mode, repositoryRoot, '');

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'prompt',
        manifest: {
          name: 'LittleGames',
          short_name: 'LittleGames',
          description: 'Small games. Big rivalries. Free multiplayer duels and solo practice.',
          start_url: '/',
          // The shell supports portrait browsing. Games request fullscreen
          // only when the player chooses it.
          display: 'standalone',
          orientation: 'any',
          background_color: '#101319',
          theme_color: '#101319',
          icons: [
            { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          ],
        },
        workbox: {
          // The shell is cached so the app opens without a network. Nothing
          // under the API is: a match is live state, and a cached snapshot of
          // it would be a lie told confidently.
          navigateFallbackDenylist: [/^\/peerjs/, /^\/v2\//, /^\/ws/, /^\/healthcheck/],
          globPatterns: ['**/*.{js,css,html,svg,png}'],
        },
      }),
    ],
    // A single .env at the repository root drives the whole project.
    envDir: repositoryRoot,
    define: {
      // The Nakama server key is public by design: it ships inside the browser
      // bundle and only authorises opening a session. Injecting it from the
      // server-side variable keeps one source of truth, so the client and the
      // server can never disagree about its value.
      'import.meta.env.VITE_NAKAMA_SERVER_KEY': JSON.stringify(env['NAKAMA_SOCKET_SERVER_KEY']),
    },
    server: {
      // Bind every interface, so Caddy can reach this dev server from its
      // container. There is no proxy configured here on purpose: Caddy already
      // routes the API, and duplicating that routing would give development two
      // sets of rules that can disagree.
      host: true,
      proxy: { '/peerjs': { target: 'http://127.0.0.1:9000', ws: true } },
      // Vite derives the HMR address from the page origin, so direct localhost
      // development and a Caddy reverse proxy both work without a forced port.
    },
  };
});
