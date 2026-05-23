/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
      '@electron': path.resolve(__dirname, './.electron'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: [
        'src/utils/**/*.ts',
        'src/stores/**/*.ts',
        'src/hooks/**/*.ts',
        'shared/**/*.ts',
        '.electron/services/SettingsManager.ts',
        '.electron/services/BookmarkManager.ts',
        '.electron/services/HistoryManager.ts',
        '.electron/services/PasswordManager.ts',
        '.electron/services/AutofillManager.ts',
        '.electron/services/DownloadStore.ts',
        '.electron/services/permissionPolicy.ts',
      ],
      exclude: ['**/*.d.ts', '**/index.ts'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
});
