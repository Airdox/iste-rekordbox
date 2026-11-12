/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'npm',
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.config.ts',
    related: true,
    pool: 'vmThreads',
  },
  mutate: [
    'src/metadata.ts',
    'src/api.ts',
    'src/camelot-wheel.tsx',
  ],
  reporters: ['progress', 'clear-text', 'json', 'html'],
  jsonReporter: {
    fileName: 'reports/mutation-frontend/stryker-report.json',
  },
  htmlReporter: {
    fileName: 'reports/mutation-frontend/index.html',
  },
  thresholds: {
    high: 97,
    low: 95,
    break: 95,
  },
  concurrency: 2,
  timeoutMS: 20000,
}
