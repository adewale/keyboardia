import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'stack-a.html'),
    },
  },
});
