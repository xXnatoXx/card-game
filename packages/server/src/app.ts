import type { ClientToServerEvents, ServerToClientEvents } from '@bluff/protocol';
import express from 'express';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { Lobby } from './lobby.js';
import { DEFAULT_SERVER_OPTIONS, type BluffServer, type ServerOptions } from './types.js';

export interface StartOptions extends Partial<ServerOptions> {
  /** 0 picks a free port. */
  port?: number;
  /** Built client to serve, if it exists. */
  staticDir?: string | null;
  /** Development: send browsers that open this server to the live Vite client on this port instead. */
  devClientPort?: number | null;
}

export interface RunningServer {
  port: number;
  io: BluffServer;
  lobby: Lobby;
  close(): Promise<void>;
}

export async function startServer(options: StartOptions = {}): Promise<RunningServer> {
  const { port = 3001, staticDir = null, devClientPort = null, ...rest } = options;
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  if (devClientPort) {
    app.get('/', (req, res) => res.redirect(`http://${req.hostname}:${devClientPort}/`));
  } else if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir));
  }

  const http = createServer(app);
  const io: BluffServer = new Server<ClientToServerEvents, ServerToClientEvents>(http, { maxHttpBufferSize: 16_000 });
  const lobby = new Lobby(io, { ...DEFAULT_SERVER_OPTIONS, ...rest });

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(port, () => resolve());
  });

  return {
    port: (http.address() as AddressInfo).port,
    io,
    lobby,
    close: () =>
      new Promise<void>((resolve) => {
        lobby.shutdown();
        void io.close(() => resolve());
      }),
  };
}
