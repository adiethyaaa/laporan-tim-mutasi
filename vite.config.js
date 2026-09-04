import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        login: resolve(import.meta.dirname, 'login.html'),
        maintenance: resolve(import.meta.dirname, 'maintenance.html'),
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 3000,
    open: true,
  },
});
