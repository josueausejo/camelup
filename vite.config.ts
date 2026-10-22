import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: {
    host: true,
    port: 5173,
    proxy: { '/socket.io': { target: 'http://localhost:3210', ws: true } },
  },
});
