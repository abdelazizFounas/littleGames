/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public Nakama server key, injected from NAKAMA_SOCKET_SERVER_KEY. */
  readonly VITE_NAKAMA_SERVER_KEY: string;
  readonly VITE_NAKAMA_HOST: string;
  readonly VITE_NAKAMA_PORT: string;
  readonly VITE_NAKAMA_USE_SSL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
