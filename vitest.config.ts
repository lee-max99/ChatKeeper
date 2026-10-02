import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'jsdom', environmentOptions: { jsdom: { url: 'https://chatgpt.com/' } }, include: ['tests/**/*.test.ts'] } });
