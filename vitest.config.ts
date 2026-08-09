import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: [
        'src/core/**/*.ts',
        'src/config/**/*.ts',
        'src/scanner/**/*.ts',
        'src/utils/**/*.ts',
        'src/webview/**/*.ts',
      ],
      thresholds: {
        lines: 75,
        functions: 75,
        statements: 75,
        branches: 65,
      },
    },
  },
});
