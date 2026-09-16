import { describe, expect, it } from 'vitest';

import { ConfigError, readConfig } from '@/app/config';

describe('defaults', () => {
  it('falls back to the demonstration backend', () => {
    const config = readConfig({});
    expect(config.backend).toBe('demo');
    expect(config.clockTickMs).toBe(60_000);
    expect(config.siteCode).toBe('FS-0412');
  });

  it('does not ask for an api base on the demo backend', () => {
    expect(() => readConfig({ VITE_BACKEND: 'demo' })).not.toThrow();
  });
});

describe('the http backend', () => {
  it('accepts an https base', () => {
    const config = readConfig({
      VITE_BACKEND: 'http',
      VITE_API_BASE_URL: 'https://netpen.example.com/api',
    });
    expect(config.backend).toBe('http');
    expect(config.apiBaseUrl).toBe('https://netpen.example.com/api');
  });

  it('accepts plain http on localhost for development', () => {
    expect(() =>
      readConfig({ VITE_BACKEND: 'http', VITE_API_BASE_URL: 'http://localhost:8080/api' }),
    ).not.toThrow();
  });

  it('refuses plain http anywhere else', () => {
    expect(() =>
      readConfig({ VITE_BACKEND: 'http', VITE_API_BASE_URL: 'http://netpen.example.com' }),
    ).toThrow(/https/);
  });

  it('refuses to start with no api base at all', () => {
    expect(() => readConfig({ VITE_BACKEND: 'http' })).toThrow(ConfigError);
    expect(() => readConfig({ VITE_BACKEND: 'http', VITE_API_BASE_URL: '' })).toThrow(/required/);
  });

  it('refuses a base that is not a URL', () => {
    expect(() =>
      readConfig({ VITE_BACKEND: 'http', VITE_API_BASE_URL: 'netpen.example.com' }),
    ).toThrow(/not a URL/);
  });
});

describe('validation', () => {
  it('refuses an unknown backend rather than guessing', () => {
    expect(() => readConfig({ VITE_BACKEND: 'graphql' })).toThrow(ConfigError);
  });

  it('coerces numbers from strings, as an environment supplies them', () => {
    expect(readConfig({ VITE_CLOCK_TICK_MS: '30000' }).clockTickMs).toBe(30_000);
  });

  it('refuses a tick fast enough to melt a tablet', () => {
    expect(() => readConfig({ VITE_CLOCK_TICK_MS: '200' })).toThrow(ConfigError);
  });

  it('refuses a tick so slow the board would go stale', () => {
    expect(() => readConfig({ VITE_CLOCK_TICK_MS: '3600000' })).toThrow(ConfigError);
  });

  it('names the setting that is wrong', () => {
    expect(() => readConfig({ VITE_CLOCK_TICK_MS: '5' })).toThrow(/VITE_CLOCK_TICK_MS/);
  });

  it('refuses a non numeric setting', () => {
    expect(() => readConfig({ VITE_CLOCK_TICK_MS: 'soon' })).toThrow(ConfigError);
  });
});
