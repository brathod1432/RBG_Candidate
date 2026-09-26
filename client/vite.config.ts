import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync } from 'fs'
import { join } from 'path'

// Vite chosen for fast HMR, small bundle, and zero-config React support
// Webpack would add complexity without benefit for this MV3 skeleton
//
// The content script is built separately (vite.content.config.ts) as one
// self-contained IIFE: MV3 content scripts cannot load ES-module chunks.

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-manifest',
      writeBundle() {
        copyFileSync(join(__dirname, 'manifest.json'), join(__dirname, 'dist', 'manifest.json'))
      }
    }
  ],
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        popup: 'popup.html',
        background: 'src/background.ts',
      },
      output: {
        entryFileNames: (chunkInfo) => {
          // Don't hash background and content scripts - manifest.json expects exact names
          if (chunkInfo.name === 'background') {
            return `${chunkInfo.name}.js`;
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
})