/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Override the Socket.IO server URL at build time.
   *
   * Set this when the client is deployed separately from the server
   * (e.g. client on Vercel, server on Fly.io). Leave unset when the server
   * serves the client from the same origin.
   *
   * Example: VITE_API_URL=https://red10-api.fly.dev
   */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
