import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  // Load every variable, not just the VITE_-prefixed ones, so the config can
  // reuse server-side values without re-declaring them.
  const env = loadEnv(mode, repositoryRoot, '');

  // Caddy is the only entry point, and it serves the client and the API on one
  // origin. The port the browser reaches the app on is therefore the same one
  // it reaches Nakama on.
  const parsedPublicPort = Number(env['VITE_NAKAMA_PORT']);
  const publicPort = Number.isInteger(parsedPublicPort) ? parsedPublicPort : 80;

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
      // Bind every interface, so Caddy can reach this dev server from its
      // container. There is no proxy configured here on purpose: Caddy already
      // routes the API, and duplicating that routing would give development two
      // sets of rules that can disagree.
      host: true,
      // The page is served through Caddy, so the hot-reload socket must be sent
      // there too. Left alone it would target this server's own port and never
      // connect.
      hmr: { clientPort: publicPort },
    },
  };
});
