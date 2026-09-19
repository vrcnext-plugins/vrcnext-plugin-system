import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Sources use `.js` specifiers so the browser bundle resolves; Vite maps them back to `.ts`.
    include: ['packages/*/src/**/*.test.ts'],
    environment: 'node',
    reporters: ['verbose'],
  },
});
