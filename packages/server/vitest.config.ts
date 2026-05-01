import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['__tests__/**/*.test.ts'],
    // A/B simulation tests run 10K+ games and take 30-80s of synchronous CPU,
    // which blocks vitest's worker IPC heartbeat and trips an "onTaskUpdate
    // timeout" even when the tests themselves pass. They're informational —
    // |z| < 2 most of the time so they don't gate anything — so exclude from
    // the default suite. Run them with `npm run test:ab` when you want the
    // signal.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*AB.test.ts',
    ],
  },
});
