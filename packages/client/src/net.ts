import type {
  ClientToServerEvents,
  GameStateMessage,
  RoomState,
  RoomSummary,
  ServerToClientEvents,
} from '@bluff/protocol';
import { io, type Socket } from 'socket.io-client';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Per tab, so two tabs are two players and a reload keeps your seat. */
function tabToken(): string {
  const key = 'bluff.token';
  try {
    const saved = sessionStorage.getItem(key);
    if (saved) return saved;
  } catch {
    /* storage blocked: a fresh token per load is fine */
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  try {
    sessionStorage.setItem(key, token);
  } catch {
    /* ignore */
  }
  return token;
}

export function savedName(): string {
  try {
    const name = localStorage.getItem('bluff.name');
    if (name) return name;
  } catch {
    /* ignore */
  }
  return `Player ${Math.floor(100 + Math.random() * 900)}`;
}

export function saveName(name: string): void {
  try {
    localStorage.setItem('bluff.name', name);
  } catch {
    /* ignore */
  }
}

export const socket: GameSocket = io({ auth: { token: tabToken(), name: savedName() } });

/** Everything the server has told us that the screens draw from. */
export const store = {
  me: { id: '', name: savedName() },
  connected: false,
  rooms: [] as RoomSummary[],
  room: null as RoomState | null,
  game: null as GameStateMessage | null,
  /** Local clock time when the current turn timer ends. */
  turnDeadline: null as number | null,
};

type Listener = () => void;
const listeners = new Set<Listener>();

/** Re-run `fn` whenever the store changes. */
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify(): void {
  for (const fn of listeners) fn();
}

socket.on('connect', () => {
  store.connected = true;
  notify();
});
socket.on('disconnect', () => {
  store.connected = false;
  notify();
});
socket.on('hello', ({ playerId, name }) => {
  store.me = { id: playerId, name };
  notify();
});
socket.on('lobby:rooms', (rooms) => {
  store.rooms = rooms;
  notify();
});
socket.on('room:state', (room) => {
  if (!room || room.id !== store.room?.id) store.game = null;
  store.room = room;
  notify();
});
socket.on('game:state', (state) => {
  store.game = state;
  store.turnDeadline = state.turnMsLeft === null ? null : Date.now() + state.turnMsLeft;
  notify();
});
