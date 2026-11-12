import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    testTimeout: 30000,
    fileParallelism: false,
    include: ['tests/frontend/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/frontend/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      all: true,
      reportsDirectory: 'reports/coverage-frontend',
      reporter: ['text', 'html', 'json', 'json-summary', 'lcov'],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 90,
        'src/metadata.ts': {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        'src/api.ts': {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        'src/camelot-wheel.tsx': {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
      },
    },
  },
})
