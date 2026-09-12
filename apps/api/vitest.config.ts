import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    // Les specs d'integration partagent UNE base : rls.spec.ts la vide dans son
    // beforeAll. En parallele, ce TRUNCATE effacerait les fixtures d'un autre
    // fichier en plein test. L'execution sequentielle supprime la course.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
