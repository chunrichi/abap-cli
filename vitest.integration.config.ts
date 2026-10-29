import { defineConfig } from 'vitest/config';

/**
 * Integration suite: tests that spawn the built CLI (`dist/index.js`) or talk
 * to `test/integration/mock-adt/server.js` over real HTTP.
 *
 * Requires `npm run build` first — build-dependent tests skip themselves when
 * `dist/index.js` is missing (same contract as before the split), so run the
 * build explicitly when running this suite standalone.
 */
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['test/setup.ts'],
    include: ['test/integration/**/*.test.ts'],
    exclude: ['test/integration/mock-adt/**', 'node_modules/**', 'dist/**'],
    globals: false,
    // Mock-server startup plus CLI child processes need more than the 5s default.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Every file starts its own mock server (fixed or kernel-assigned port) and
    // spawns children; sequential files keep startup deterministic on CI.
    fileParallelism: false,
  },
});
