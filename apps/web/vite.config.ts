import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const viteEnv = loadEnv(mode, process.cwd(), '');
  const apiProxyTarget = process.env.API_BASE_URL ?? viteEnv.API_BASE_URL ?? 'http://localhost:3000';

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 3001,
      proxy: {
        '/backend': {
          target: apiProxyTarget,
          changeOrigin: true,
          rewrite: (requestPath) => requestPath.replace(/^\/backend/, ''),
        },
      },
    },
  };
});
