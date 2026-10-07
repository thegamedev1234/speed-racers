import { defineConfig } from 'vite';

/**
 * Dev server binds 0.0.0.0 so it works inside sandboxes / containers and is
 * reachable through proxied preview hosts. `/socket.io` is proxied to the
 * bundled multiplayer relay (npm run server) so the client can always connect
 * to its own origin — no hard-coded localhost URLs anywhere in the game.
 */
export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: true,
    cors: true,
    proxy: {
      '/socket.io': {
        target: process.env.SR_SERVER || 'http://127.0.0.1:3001',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          'three-vendor': ['three'],
          'net-vendor': ['socket.io-client'],
        },
      },
    },
  },
});
