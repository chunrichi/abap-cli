import { defineConfig } from 'vitest/config';

/** Unit suite: pure in-process tests only. No built CLI, no real HTTP. */
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['test/setup.ts'],
    include: ['test/unit/**/*.test.ts'],
    exclude: ['test/integration/**', 'node_modules/**', 'dist/**'],
    globals: false,
  },
});
