// Builds a standalone server folder you can copy to another PC and run with just Node.js:
//
//   release/false-alarm-server/
//     server.mjs   the whole server (rules, protocol, socket.io, express) in one file
//     public/      the built game, served to every browser that connects
//     start.bat    double-click on Windows
//     start.sh     for macOS / Linux
//     README.txt
//
// Usage: npm run build:server

import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'release', 'false-alarm-server');

console.log('Building the game client…');
execSync('npm run build -w @bluff/client', { cwd: root, stdio: 'inherit' });
const clientDist = join(root, 'packages', 'client', 'dist');
if (!existsSync(join(clientDist, 'index.html'))) throw new Error('Client build did not produce index.html');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

console.log('Bundling the server…');
await build({
  entryPoints: [join(root, 'packages', 'server', 'src', 'index.ts')],
  outfile: join(out, 'server.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  // Optional native speed-ups for the WebSocket library; it works without them.
  external: ['bufferutil', 'utf-8-validate'],
  // Bundled CommonJS dependencies still call require().
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  legalComments: 'none',
  logLevel: 'warning',
});

cpSync(clientDist, join(out, 'public'), { recursive: true });

writeFileSync(
  join(out, 'start.bat'),
  ['@echo off', 'cd /d "%~dp0"', 'node server.mjs --port=3001', 'pause', ''].join('\r\n'),
);
writeFileSync(join(out, 'start.sh'), ['#!/bin/sh', 'cd "$(dirname "$0")"', 'exec node server.mjs --port=3001', ''].join('\n'), {
  mode: 0o755,
});
writeFileSync(
  join(out, 'README.txt'),
  `False Alarm - game server
=========================

Needs Node.js 20 or newer (https://nodejs.org). Nothing else to install.

Start it
  Windows:        double-click start.bat
  macOS / Linux:  ./start.sh
  Any:            node server.mjs --port=3001

The window prints the addresses to open, for example:
  On your network: http://192.168.1.50:3001

Everyone (this PC included) opens that address in a browser to play.

Notes
  - Allow Node.js through the firewall when Windows asks, or open TCP port 3001
    (Private networks), or other PCs will not be able to connect.
  - Use a different port with --port=4000 (or the PORT environment variable).
  - Rooms and games live in memory: closing the server ends every game.
  - The animal models in public/models/animals are Kenney "Cube Pets" (CC0).
  - The music's guitar, bass and drum recordings are credited in public/samples/CREDITS.txt.
`,
);

console.log(`\nDone: ${out}\nCopy that folder to the server PC and run start.bat (or ./start.sh).`);
