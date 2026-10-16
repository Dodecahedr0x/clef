import { defineConfig } from 'vitest/config';

declare module 'vitest' {
  export interface ProvidedContext {
    surfpoolRpcUrl: string;
  }
}

const LOCAL = '**/*.local.test.ts';
const LIVE = '**/*.live.test.ts';
const IGNORED = ['**/node_modules/**', '**/.output/**', '**/.wxt/**'];

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'test/**/*.test.ts'],
          exclude: [...IGNORED, LOCAL, LIVE],
        },
      },
      {
        extends: true,
        test: {
          name: 'unit-dom',
          include: ['packages/*/test/**/*.test.tsx', 'apps/*/test/**/*.test.tsx', 'test/**/*.test.tsx'],
          exclude: IGNORED,
          environment: 'jsdom',
          setupFiles: ['test/setup-dom.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'local',
          include: [LOCAL],
          exclude: IGNORED,
          globalSetup: ['test/surfpool.setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'live',
          include: [LIVE],
          exclude: IGNORED,
          fileParallelism: false,
          testTimeout: 60_000,
        },
      },
    ],
  },
});
