import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    // Integration specs run `prisma migrate` SQL against a temp SQLite file.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
