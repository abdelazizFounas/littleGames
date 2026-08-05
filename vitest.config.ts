import { defineConfig } from 'vitest/config';

// `projects` replaces the deprecated `vitest.workspace.ts` file (Vitest >= 3.2).
// Every workspace package that ships tests is picked up through these globs.
export default defineConfig({
  test: {
    projects: ['packages/*', 'packages/games/*/*'],
    // Phase 0 ships contracts only; the first real suites land with the Pong
    // logic package in phase 4.
    passWithNoTests: true,
  },
});
