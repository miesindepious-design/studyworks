/**
 * Vitest config for the client-side pure-function tests.
 *
 * jsdom is used so the tests can use `crypto.randomUUID` and a global
 * `Date` without bringing in a full browser environment. The `src/hooks/`
 * and `src/components/` directories still need a real browser to test
 * (they pull in React + DOM APIs); we test only the pure utilities here.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
