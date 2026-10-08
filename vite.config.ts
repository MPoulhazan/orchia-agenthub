import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4317', ws: true },
    },
  },
});
