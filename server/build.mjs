import { build } from 'esbuild';
import path from 'node:path';

// Bundles the API (including ../shared) into a single file. Dependencies stay external (installed in the image).
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  packages: 'external',
  alias: { '@bluecollar/shared': path.resolve('../shared/src/index.ts') },
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});
