import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  // Load every variable, not just the VITE_-prefixed ones, so the config can
  // reuse server-side values without re-declaring them.
  const env = loadEnv(mode, repositoryRoot, '');

  // Where the dev server forwards API and socket traffic. Pointing it at Caddy
  // rather than at Nakama directly means development goes through the same
  // proxy as production.
  const apiProxyTarget = env['DEV_API_PROXY_TARGET'] ?? 'http://localhost';

  return {
    plugins: [react()],
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
      // Same-origin in development, exactly as in production, so no CORS rule
      // has to exist purely for the dev server.
      proxy: {
        '/v2': { target: apiProxyTarget, changeOrigin: true },
        '/ws': { target: apiProxyTarget, changeOrigin: true, ws: true },
      },
    },
  };
});
