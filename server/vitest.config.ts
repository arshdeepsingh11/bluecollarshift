import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@bluecollar/shared': path.resolve(__dirname, '../shared/src/index.ts') } },
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    include: ['tests/**/*.test.ts'],
  },
});
