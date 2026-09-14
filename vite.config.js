import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  server: {
    port: 5173,
    open: '/demo.html'
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        demo: resolve(import.meta.dirname, 'demo.html'),
        popup: resolve(import.meta.dirname, 'popup/popup.html'),
        content: resolve(import.meta.dirname, 'src/content/content.js'),
        background: resolve(import.meta.dirname, 'src/background/background.js')
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    }
  }
});
