import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    // App bootstrap per test + a loaded dev machine (client & server dev
    // processes often running alongside) makes the 5s default flaky on
    // Windows. Timeouts here cascade: a timed-out test leaks its
    // mockResolvedValueOnce queue into the next test.
    testTimeout: 20000,
  },
});
