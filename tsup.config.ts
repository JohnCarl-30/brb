import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { brb: 'src/cli.ts' },
  format: 'esm',
  outExtension: () => ({ js: '.mjs' }),
  platform: 'node',
  target: 'node20',
  noExternal: [/.*/],
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  splitting: false,
});
