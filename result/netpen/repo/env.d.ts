/// <reference types="vite/client" />

/**
 * Environment the interface reads at start up. Declared rather than inferred so
 * a misspelt variable is a compile error and not an undefined at runtime.
 */
interface ImportMetaEnv {
  readonly VITE_BACKEND: 'demo' | 'http';
  readonly VITE_API_BASE_URL: string;
  readonly VITE_SITE_CODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
