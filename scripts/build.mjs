import { build as viteBuild } from 'vite';
import { build as bundle } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import './icons.mjs';
import './notices.mjs';
await viteBuild({ base: './', build: { outDir: 'dist', rollupOptions: { input: 'popup.html' } } });
await bundle({ entryPoints: ['src/content.ts', 'src/background.ts'], outdir: 'dist', bundle: true, format: 'iife', target: 'chrome109', minify: true,
  plugins: [{ name: 'raw-text', setup(build) {
    build.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw-text' }));
    build.onLoad({ filter: /.*/, namespace: 'raw-text' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text' }));
  } }],
});
