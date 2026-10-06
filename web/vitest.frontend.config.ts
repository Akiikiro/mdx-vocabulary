import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.frontend.ts', 'src/**/*.frontend.tsx'],
  },
});
