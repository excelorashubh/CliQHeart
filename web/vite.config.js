import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '');
  const apiUrl = new URL(environment.VITE_API_BASE_URL || 'https://cliqheart.onrender.com/api/v1');
  const apiPath = apiUrl.pathname.replace(/\/+$/, '') || '/api/v1';

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      proxy: {
        [apiPath]: {
          target: apiUrl.origin,
          changeOrigin: true,
          secure: true,
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test-setup.js',
      restoreMocks: true,
      clearMocks: true,
    },
  };
});
