import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { patchXtermMobileInput } from './xterm-mobile-patch'

export default defineConfig({
  plugins: [react(), {
    name: 'xterm-mobile-input-fix',
    enforce: 'pre',
    transform(code, id) {
      if (id.replaceAll('\\', '/').endsWith('/@xterm/xterm/lib/xterm.js')) {
        return { code: patchXtermMobileInput(code), map: null }
      }
    },
  }],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**'],
    restoreMocks: true,
    clearMocks: true,
  },
  build: {
    target: 'es2022',
    minify: 'terser',
    terserOptions: {
      compress: { passes: 2 },
      format: { comments: false },
    },
    outDir: '../pkg/server/dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          xterm: ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-web-links', '@xterm/addon-clipboard'],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:7654',
      '/ws': {
        target: 'ws://localhost:7654',
        ws: true,
      },
    },
  },
})
