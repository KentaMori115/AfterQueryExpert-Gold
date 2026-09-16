import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'happy-dom',
      globals: true,
      include: ['src/**/*.{spec,test}.{ts,vue}'],
      setupFiles: ['./src/test-setup.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html'],
        thresholds: {
          statements: 70,
          branches: 60,
          functions: 65,
          lines: 70,
        },
        exclude: [
          'node_modules/**',
          'dist/**',
          'src/main.ts',
          'src/test-setup.ts',
          '**/*.spec.ts',
          '**/*.test.ts',
        ],
      },
    },
  }),
)
