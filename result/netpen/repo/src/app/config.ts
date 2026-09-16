import { z } from 'zod';

/**
 * Runtime configuration.
 *
 * Read once, validated once, and wrong values stop the application starting
 * rather than surfacing three screens in. A site deployment handed a malformed
 * API base should refuse to load, not quietly fall back to demonstration data
 * and show somebody a pile of fictional pens next to their real ones.
 */

const rawSchema = z.object({
  VITE_BACKEND: z.enum(['demo', 'http']).default('demo'),
  VITE_API_BASE_URL: z.string().default(''),
  VITE_SITE_CODE: z.string().default('FS-0412'),
  VITE_CLOCK_TICK_MS: z.coerce.number().int().min(5_000).max(600_000).default(60_000),
});

export type Backend = 'demo' | 'http';

export interface AppConfig {
  readonly backend: Backend;
  readonly apiBaseUrl: string;
  readonly siteCode: string;
  readonly clockTickMs: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function readConfig(source: Record<string, unknown>): AppConfig {
  const parsed = rawSchema.safeParse(source);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ConfigError(
      `Configuration is not usable: ${first?.path.join('.') ?? 'unknown'} ${first?.message ?? ''}`.trim(),
    );
  }

  const values = parsed.data;

  if (values.VITE_BACKEND === 'http') {
    if (values.VITE_API_BASE_URL === '') {
      throw new ConfigError('VITE_API_BASE_URL is required when the backend is http');
    }
    let url: URL;
    try {
      url = new URL(values.VITE_API_BASE_URL);
    } catch {
      throw new ConfigError(`VITE_API_BASE_URL is not a URL: ${values.VITE_API_BASE_URL}`);
    }
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
      throw new ConfigError('The API base must be https outside local development');
    }
  }

  return {
    backend: values.VITE_BACKEND,
    apiBaseUrl: values.VITE_API_BASE_URL,
    siteCode: values.VITE_SITE_CODE,
    clockTickMs: values.VITE_CLOCK_TICK_MS,
  };
}

export function readEnvironment(): AppConfig {
  return readConfig(import.meta.env as unknown as Record<string, unknown>);
}
