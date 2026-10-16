import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Ports come from the shared .env in the project root.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '..', '');
  const apiPort = env.PORT || 5000;
  const clientPort = Number(new URL(env.CLIENT_URL || 'http://localhost:5173').port) || 5173;
  return {
    plugins: [react()],
    server: {
      port: clientPort,
      strictPort: true, // Google redirects back to CLIENT_URL, so the port can't drift
      proxy: {
        '/api': `http://localhost:${apiPort}`,
      },
    },
  };
});
