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
        '/api': {
          target: `http://localhost:${apiPort}`,
          // A clear message instead of a blank 500 while the API is starting or has stopped.
          configure: (proxy) =>
            proxy.on('error', (err, req, res) => {
              if (res.headersSent) return;
              res.writeHead(503, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'The CareerPulse API isn’t running yet. Give it a few seconds, or check the server terminal.' }));
            }),
        },
      },
    },
  };
});
