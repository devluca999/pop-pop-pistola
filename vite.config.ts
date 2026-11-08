import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
});
