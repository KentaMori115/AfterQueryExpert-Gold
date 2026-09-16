import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config';

/*
 * Split out from the Vite config because the test run wants a different set of
 * plugins and its own resolution, and because a single file that does both ends
 * up with conditionals nobody can read.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
      exclude: [...configDefaults.exclude, 'e2e/**'],
      root: fileURLToPath(new URL('./', import.meta.url)),
      globals: false,
      restoreMocks: true,
      clearMocks: true,

      /*
       * The thresholds are floors rather than targets, and they are not the
       * same everywhere on purpose. The domain is pure arithmetic that decides
       * whether fish are fed and whether a site is in breach, so it is held at
       * a height the screens are not: a chart component with an unexercised
       * branch is a cosmetic bug, and a growth curve with one is a wrong
       * harvest date.
       */
      coverage: {
        provider: 'v8',
        reporter: ['text-summary', 'lcov'],
        reportsDirectory: 'coverage',
        include: ['src/**/*.{ts,vue}'],
        exclude: [
          'src/main.ts',
          'src/**/*.d.ts',
          // Generated demonstration data. Exercised through everything that
          // reads it, but counting its own lines would flatter the figure.
          'src/data/fixtures/**',
        ],
        thresholds: {
          lines: 80,
          functions: 80,
          branches: 75,
          statements: 80,
          'src/domain/**': {
            lines: 95,
            functions: 95,
            branches: 90,
            statements: 95,
          },
        },
      },
    },
  }),
);
