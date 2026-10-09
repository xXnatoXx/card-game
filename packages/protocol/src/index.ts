import type { GameEvent, InspectView, PlayerView, Rank, Seat, Stack } from '@bluff/rules';

/** Kenney "Cube Pets" models (CC0), served from the client's public/models/animals folder. */
export const ANIMALS = [
  'beaver', 'bee', 'bunny', 'cat', 'caterpillar', 'chick', 'cow', 'crab',
  'deer', 'dog', 'elephant', 'fish', 'fox', 'giraffe', 'hog', 'koala',
  'lion', 'monkey', 'panda', 'parrot', 'penguin', 'pig', 'polar', 'tiger',
] as const;
export type Animal = (typeof ANIMALS)[number];

export function isAnimal(value: unknown): value is Animal {
  return typeof value === 'string' && (ANIMALS as readonly string[]).includes(value);
}

export const MAX_ROOM_PLAYERS = 13;
export const MAX_NAME_LENGTH = 20;
export const MAX_ROOM_NAME_LENGTH = 30;

export type RoomStatus = 'waiting' | 'full' | 'playing' | 'closed';

/** One row in the lobby's room list. */
export interface RoomSummary {
  id: string;
  name: string;
  host: string;
  players: number;
  maxPlayers: number;
  status: RoomStatus;
  /** 2 for x2 mode: two decks shuffled together, the second printed in inverted colours. */
  decks: number;
}

export interface RoomMember {
  id: string;
  name: string;
  animal: Animal;
  connected: boolean;
  bot: boolean;
}

export interface RoomState {
  id: string;
  name: string;
  hostId: string;
  status: RoomStatus;
  decks: number;
  /** In seat order once a game has started. */
  members: RoomMember[];
}

/** Sent to one player: everything they may know about the game right now. */
export interface GameStateMessage {
  view: PlayerView;
  /** By seat. */
  seats: RoomMember[];
  /** Milliseconds left on the current turn's timer, or null when no timer runs. */
  turnMsLeft: number | null;
}

export type PlayedMessage = Extract<GameEvent, { type: 'played' }>;
export type PassedMessage = Extract<GameEvent, { type: 'passed' }>;
export type RevealMessage = Extract<GameEvent, { type: 'revealed' }>;
export type RoundEndMessage = Extract<GameEvent, { type: 'roundEnded' }>;
export type GameOverMessage = Extract<GameEvent, { type: 'gameOver' }>;

export interface ServerToClientEvents {
  hello: (msg: { playerId: string; name: string }) => void;
  'lobby:rooms': (rooms: RoomSummary[]) => void;
  /** null once you are no longer in a room. */
  'room:state': (room: RoomState | null) => void;
  'game:state': (state: GameStateMessage) => void;
  'turn:played': (msg: PlayedMessage) => void;
  'turn:passed': (msg: PassedMessage) => void;
  'turn:inspectView': (view: InspectView) => void;
  /** Someone leaned in to inspect the latest play. */
  'turn:inspected': (msg: { by: Seat }) => void;
  'turn:reveal': (msg: RevealMessage) => void;
  'round:end': (msg: RoundEndMessage) => void;
  'game:over': (msg: GameOverMessage) => void;
  error: (msg: { reason: string }) => void;
}

export interface PlayPayload {
  cardIds: string[];
  stacks: Stack[];
  rank: Rank;
}

export interface ClientToServerEvents {
  'profile:setName': (msg: { name: string }) => void;
  /** `double`: x2 mode, two decks with the second printed in inverted colours. */
  'room:create': (msg: { name: string; double?: boolean }) => void;
  'room:join': (msg: { roomId: string }) => void;
  'room:leave': () => void;
  'room:setAnimal': (msg: { animal: Animal }) => void;
  'room:addBot': () => void;
  'room:removeBot': (msg: { memberId: string }) => void;
  'game:start': () => void;
  'turn:play': (msg: PlayPayload) => void;
  'turn:pass': () => void;
  'turn:inspect': () => void;
  'turn:callBluff': () => void;
}

/** Sent in the Socket.IO handshake. The token is kept per browser tab and lets a player reconnect to their seat. */
export interface HandshakeAuth {
  token: string;
  name: string;
}
