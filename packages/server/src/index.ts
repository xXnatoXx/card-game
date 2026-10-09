import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer } from './app.js';

// `--port=N` wins over PORT, so tools that set PORT for the client dev server don't move this one.
const portArg = process.argv.find((a) => a.startsWith('--port='))?.slice('--port='.length);
const port = Number(portArg ?? process.env.PORT ?? 3001);

// `--dev`: the game is served live by Vite, so never serve a (possibly stale) build; redirect to Vite.
const dev = process.argv.includes('--dev');
const DEV_CLIENT_PORT = 5173;

// The built game: STATIC_DIR if set, `public/` beside a standalone server bundle, or the client's build output in the repo.
const staticDir = dev
  ? null
  : ([process.env.STATIC_DIR, fileURLToPath(new URL('./public', import.meta.url)), fileURLToPath(new URL('../../client/dist', import.meta.url))].find(
      (dir) => dir && existsSync(dir),
    ) ?? null);
const server = await startServer({ port, staticDir, devClientPort: dev ? DEV_CLIENT_PORT : null });
if (!dev && !staticDir) console.warn('No built game found, so only the WebSocket server is running. Run `npm run build -w @bluff/client` first.');

const gamePort = dev ? DEV_CLIENT_PORT : server.port;
const lan = Object.values(networkInterfaces())
  .flat()
  .filter((a) => a && a.family === 'IPv4' && !a.internal)
  .map((a) => `http://${a!.address}:${gamePort}`);
console.log(`False Alarm server listening on port ${server.port}${dev ? ' (development)' : ''}`);
console.log(`Open the game at http://localhost:${gamePort}`);
if (lan.length) console.log(`On your network: ${lan.join('  ')}`);

const stop = () => void server.close().then(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
