import { defineConfig } from 'vite'

// Content script: single self-contained IIFE (no import statements), appended
// to dist/ after the main build. Safe to inject twice (no top-level bindings).
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: 'src/content.ts',
      formats: ['iife'],
      name: 'rbgContent',
      fileName: () => 'content.js',
    },
    rollupOptions: {
      output: { extend: true },
    },
  },
})
