import { defineConfig } from 'vitest/config';

// Standalone config for A/B tests. The default vitest.config.ts excludes
// `**/*AB.test.ts` to keep the regular suite snappy; this override re-includes
// them so we can run the simulation suite explicitly.
export default defineConfig({
  test: {
    globals: true,
    include: ['__tests__/**/*AB.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 600000,  // 10 min — these simulations are slow
    hookTimeout: 600000,
  },
});
