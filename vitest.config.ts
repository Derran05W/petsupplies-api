import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      all: true,
      include: ['src/**/*.ts'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'tests/**',
        'coverage/**',
        '**/*.d.ts',
        'src/index.ts',
        'src/types/hono.ts',
        'eslint.config.js',
        'commitlint.config.js',
        'lint-staged.config.js',
        'prisma.config.ts',
        'tsconfig.json',
        'tsconfig.check.json',
        'vitest.config.ts',
      ],
      reporter: ['text', 'text-summary', 'lcov', 'html'],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 70,
      },
    },
  },
});
