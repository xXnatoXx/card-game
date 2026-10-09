import { isAnimal, MAX_NAME_LENGTH, MAX_ROOM_NAME_LENGTH, type RoomSummary } from '@bluff/protocol';
import { randomBytes, randomUUID } from 'node:crypto';
import { Room } from './room.js';
import type { BluffServer, BluffSocket, Human, ServerOptions } from './types.js';
import { getField, parseAuth, parseName, parsePlay } from './validate.js';

/** Holds every player and room, and routes each socket's messages. */
export class Lobby {
  private readonly humans = new Map<string, Human>(); // by token
  private readonly rooms = new Map<string, Room>();

  constructor(
    private readonly io: BluffServer,
    private readonly options: ServerOptions,
  ) {
    io.on('connection', (socket) => this.connect(socket));
  }

  roomList(): RoomSummary[] {
    return [...this.rooms.values()].sort((a, b) => a.createdAt - b.createdAt).map((r) => r.summary());
  }

  shutdown(): void {
    for (const room of this.rooms.values()) room.shutdown();
    for (const h of this.humans.values()) if (h.holdTimer) clearTimeout(h.holdTimer);
  }

  private broadcastRooms(): void {
    this.io.to('lobby').emit('lobby:rooms', this.roomList());
  }

  private connect(socket: BluffSocket): void {
    const auth = parseAuth(socket.handshake.auth, MAX_NAME_LENGTH);
    if (!auth) {
      socket.emit('error', { reason: 'Bad handshake.' });
      socket.disconnect(true);
      return;
    }

    let h = this.humans.get(auth.token);
    if (h) {
      if (h.holdTimer) clearTimeout(h.holdTimer);
      h.holdTimer = null;
      const old = h.socket;
      h.socket = socket;
      if (old) {
        old.emit('error', { reason: 'You opened the game somewhere else.' });
        old.disconnect(true);
      }
    } else {
      h = { id: randomUUID(), token: auth.token, name: auth.name, socket, room: null, holdTimer: null };
      this.humans.set(h.token, h);
    }
    const human = h;

    socket.emit('hello', { playerId: human.id, name: human.name });
    if (human.room) {
      human.room.reconnected(human);
    } else {
      void socket.join('lobby');
      socket.emit('room:state', null);
      socket.emit('lobby:rooms', this.roomList());
    }

    const on = (event: string, handler: (msg: unknown) => string | null | undefined) => {
      socket.on(event as 'room:leave', (msg?: unknown) => {
        try {
          const error = handler(msg);
          if (error) socket.emit('error', { reason: error });
        } catch (err) {
          console.error(`Error handling ${event}:`, err);
          socket.emit('error', { reason: 'Something went wrong on the server.' });
        }
      });
    };
    const inRoom = (fn: (room: Room) => string | null | undefined) => () =>
      human.room ? fn(human.room) : 'You are not in a room.';

    on('profile:setName', (msg) => {
      const name = parseName(getField(msg, 'name'), MAX_NAME_LENGTH);
      if (!name) return `Names are 1 to ${MAX_NAME_LENGTH} characters.`;
      human.name = name;
      socket.emit('hello', { playerId: human.id, name });
      human.room?.renamed(human);
      return null;
    });

    on('room:create', (msg) => {
      if (human.room) return 'Leave your current room first.';
      const name = parseName(getField(msg, 'name'), MAX_ROOM_NAME_LENGTH);
      if (!name) return `Room names are 1 to ${MAX_ROOM_NAME_LENGTH} characters.`;
      const decks = getField(msg, 'double') === true ? 2 : 1;
      const room = new Room(
        this.newRoomId(),
        name,
        human,
        {
          io: this.io,
          options: this.options,
          roomsChanged: () => this.broadcastRooms(),
          roomClosed: (r) => {
            this.rooms.delete(r.id);
            this.broadcastRooms();
          },
        },
        decks,
      );
      this.rooms.set(room.id, room);
      return room.addHuman(human);
    });

    on('room:join', (msg) => {
      if (human.room) return 'Leave your current room first.';
      const room = this.rooms.get(String(getField(msg, 'roomId')));
      if (!room) return 'That room no longer exists.';
      return room.addHuman(human);
    });

    on('room:leave', inRoom((room) => void room.leave(human)));
    on('room:setAnimal', (msg) => {
      const animal = getField(msg, 'animal');
      if (!isAnimal(animal)) return 'Unknown animal.';
      return human.room ? human.room.setAnimal(human, animal) : 'You are not in a room.';
    });
    on('room:addBot', inRoom((room) => room.addBot(human.id)));
    on('room:removeBot', (msg) =>
      human.room ? human.room.removeBot(human.id, String(getField(msg, 'memberId'))) : 'You are not in a room.',
    );
    on('game:start', inRoom((room) => room.start(human.id)));

    on('turn:play', (msg) => {
      const payload = parsePlay(msg);
      if (!payload) return 'That play could not be read.';
      return human.room ? human.room.humanAction(human, 'play', payload) : 'You are not in a room.';
    });
    on('turn:pass', inRoom((room) => room.humanAction(human, 'pass')));
    on('turn:callBluff', inRoom((room) => room.humanAction(human, 'callBluff')));
    on('turn:inspect', inRoom((room) => room.inspectFor(human)));

    socket.on('disconnect', () => {
      if (human.socket !== socket) return; // replaced by a newer connection
      human.socket = null;
      human.room?.disconnected(human);
      human.holdTimer = setTimeout(() => {
        human.holdTimer = null;
        if (human.socket) return;
        human.room?.holdExpired(human);
        if (!human.room) this.humans.delete(human.token);
      }, this.options.seatHoldMs);
    });
  }

  private newRoomId(): string {
    let id: string;
    do id = randomBytes(4).toString('hex');
    while (this.rooms.has(id));
    return id;
  }
}
