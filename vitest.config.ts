// vitest.config.ts

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@core': `${root}app/core`,
    },
  },
  test: {
    include: ['app/core/test/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/.nuxt/**', '**/dist/**'],
    environment: 'node',
    globals: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    reporters: process.env.CI
      ? ['default', ['github-actions', { silent: false }]]
      : ['default'],
    pool: 'forks',
  },
});
