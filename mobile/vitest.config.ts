import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@bluecollar/shared': path.resolve(__dirname, '../shared/src/index.ts') } },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
