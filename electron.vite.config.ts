import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import path from 'path';

export default defineConfig({
  main: {
    build: {
      lib: {
        entry: path.resolve(__dirname, '.electron/main.ts'),
        formats: ['cjs'],
        fileName: () => 'main.js',
      },
      outDir: 'dist-electron',
      emptyOutDir: false,
      rollupOptions: {
        external: [
          'electron', 'electron-updater',
          'path', 'fs', 'fs/promises', 'os', 'crypto', 'net', 'child_process', 'events', 'stream',
          // Reader mode deps — JSDOM is a Node-only library, must not bundle.
          '@mozilla/readability', 'jsdom',
        ],
      },
    },
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, './shared'),
      },
    },
  },
  preload: {
    build: {
      lib: {
        entry: path.resolve(__dirname, '.electron/preload.ts'),
        formats: ['cjs'],
        fileName: () => 'preload.js',
      },
      outDir: 'dist-electron',
      emptyOutDir: false,
      rollupOptions: {
        external: ['electron'],
      },
    },
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, './shared'),
      },
    },
  },
  renderer: {
    root: '.',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: path.resolve(__dirname, 'index.html'),
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@shared': path.resolve(__dirname, './shared'),
      },
    },
  },
});
