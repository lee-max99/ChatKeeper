import { build as viteBuild } from 'vite';
import { build as bundle } from 'esbuild';
import './icons.mjs';
import './notices.mjs';
await viteBuild({ base: './', build: { outDir: 'dist', rollupOptions: { input: 'popup.html' } } });
await bundle({ entryPoints: ['src/content.ts', 'src/background.ts'], outdir: 'dist', bundle: true, format: 'iife', target: 'chrome109', minify: true });
