import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    force: true,          // always clear the pre-bundle cache on startup
    watch: {
      usePolling: true,   // needed for Docker volume mounts on Mac
      interval: 500,
    },
    proxy: {
      '/api': {
        target: 'http://backend:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
