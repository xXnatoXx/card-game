import { defineConfig } from 'vite';

// Stamped into the game and shown in the lobby, so it's obvious which build a server is running.
const stamp = new Date();
const pad = (n: number) => String(n).padStart(2, '0');
const BUILD_TIME = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(stamp.getHours())}:${pad(stamp.getMinutes())}`;

export default defineConfig({
  define: { __BUILD_TIME__: JSON.stringify(BUILD_TIME) },
  server: {
    host: true,
    port: 5173,
    // The game server runs separately in development; forward its WebSocket.
    proxy: { '/socket.io': { target: 'http://localhost:3001', ws: true } },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
