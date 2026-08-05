import type { NakamaConfig } from '@littlegames/net';

function required(name: string, value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

/**
 * Builds the server configuration from the environment.
 *
 * Failing loudly at startup is deliberate: a silently defaulted host or server
 * key produces authentication errors that look like server faults and are
 * tedious to trace back to a missing variable.
 */
export function readNakamaConfig(): NakamaConfig {
  return {
    serverKey: required('NAKAMA_SOCKET_SERVER_KEY', import.meta.env.VITE_NAKAMA_SERVER_KEY),
    host: required('VITE_NAKAMA_HOST', import.meta.env.VITE_NAKAMA_HOST),
    port: required('VITE_NAKAMA_PORT', import.meta.env.VITE_NAKAMA_PORT),
    useSSL: required('VITE_NAKAMA_USE_SSL', import.meta.env.VITE_NAKAMA_USE_SSL) === 'true',
  };
}
