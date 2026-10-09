import type { Rng } from '@bluff/rules';
import type { ClientToServerEvents, ServerToClientEvents } from '@bluff/protocol';
import type { Server, Socket } from 'socket.io';

export type BluffServer = Server<ClientToServerEvents, ServerToClientEvents>;
export type BluffSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export interface ServerOptions {
  /** Turn timer. When it runs out the player passes, or plays one random card if they cannot pass. */
  turnMs: number;
  /** How long a disconnected player's seat is held before their turns are played for them. */
  seatHoldMs: number;
  /** Delay before acting for a player whose seat hold ran out, so the table can see it happen. */
  autoActDelayMs: number;
  /** Bots wait this long before taking their turn, which gives people time to call the last play. */
  botTurnMs: [min: number, max: number];
  /** Bots wait this long before deciding whether to call a play. */
  botCallMs: [min: number, max: number];
  rng: Rng;
}

export const DEFAULT_SERVER_OPTIONS: ServerOptions = {
  turnMs: 30_000,
  seatHoldMs: 60_000,
  autoActDelayMs: 1_200,
  botTurnMs: [2_500, 4_500],
  botCallMs: [1_200, 3_500],
  rng: Math.random,
};

/** A connected (or recently connected) person. Identified across reconnects by their token. */
export interface Human {
  id: string;
  /** Secret, known only to this player's browser tab. Never sent to anyone else. */
  token: string;
  name: string;
  socket: BluffSocket | null;
  room: import('./room.js').Room | null;
  holdTimer: NodeJS.Timeout | null;
}
