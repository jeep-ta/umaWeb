import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    emptyOutDir: false,
    outDir: 'dist',
    rollupOptions: {
      input: resolve(import.meta.dirname, 'src/content/content.js'),
      output: {
        format: 'iife',
        entryFileNames: 'content.bundle.js',
        name: 'ChibiContent'
      }
    }
  }
});
