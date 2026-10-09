import type { ClientToServerEvents, GameStateMessage, RoomState, ServerToClientEvents } from '@bluff/protocol';
import { seededRng } from '@bluff/rules';
import { randomBytes } from 'node:crypto';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type RunningServer, type StartOptions } from '../src/app.js';

type Events = ServerToClientEvents;
type Payload<E extends keyof Events> = Parameters<Events[E]>[0];
interface Client extends Socket<Events, ClientToServerEvents> {
  log: { event: string; data: unknown }[];
  token: string;
}

let server: RunningServer | null = null;
const clients: Client[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect();
  await server?.close();
  server = null;
});

async function start(options: StartOptions = {}): Promise<void> {
  server = await startServer({
    port: 0,
    turnMs: 60_000,
    seatHoldMs: 60_000,
    autoActDelayMs: 5,
    botTurnMs: [5, 10],
    botCallMs: [1, 4],
    rng: seededRng(1),
    ...options,
  });
}

function client(name: string, token = randomBytes(12).toString('hex')): Client {
  const c = connect(`http://localhost:${server!.port}`, {
    auth: { token, name },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  }) as Client;
  c.log = [];
  c.token = token;
  c.onAny((event: string, data: unknown) => c.log.push({ event, data }));
  clients.push(c);
  return c;
}

function waitFor<E extends keyof Events>(
  c: Client,
  event: E,
  match: (data: Payload<E>) => boolean = () => true,
  from = 0,
): Promise<Payload<E>> {
  return new Promise((resolve, reject) => {
    const check = () => {
      for (let i = from; i < c.log.length; i++) {
        const e = c.log[i]!;
        if (e.event === event && match(e.data as Payload<E>)) {
          cleanup();
          resolve(e.data as Payload<E>);
          return;
        }
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${event}`));
    }, 5_000);
    const cleanup = () => {
      clearTimeout(timer);
      c.offAny(check);
    };
    c.onAny(check);
    check();
  });
}

const mark = (c: Client) => c.log.length;
const lastState = (c: Client) =>
  [...c.log].reverse().find((e) => e.event === 'game:state')?.data as GameStateMessage | undefined;

/** Two players in one room, A hosting. */
async function twoInRoom(): Promise<{ a: Client; b: Client; room: RoomState }> {
  const a = client('Ann');
  const b = client('Ben');
  await Promise.all([waitFor(a, 'hello'), waitFor(b, 'hello')]);
  a.emit('room:create', { name: 'The Den' });
  const listed = await waitFor(b, 'lobby:rooms', (rooms) => rooms.some((r) => r.name === 'The Den'));
  b.emit('room:join', { roomId: listed.find((r) => r.name === 'The Den')!.id });
  const room = await waitFor(a, 'room:state', (r) => r?.members.length === 2);
  return { a, b, room: room! };
}

async function startGame(a: Client, b: Client) {
  a.emit('game:start');
  const [sa, sb] = await Promise.all([waitFor(a, 'game:state'), waitFor(b, 'game:state')]);
  return { sa, sb };
}

describe('lobby and rooms', () => {
  it('lists rooms live and lets a second player join', async () => {
    await start();
    const { a, room } = await twoInRoom();
    expect(room.name).toBe('The Den');
    expect(room.members.map((m) => m.name)).toEqual(['Ann', 'Ben']);
    expect(new Set(room.members.map((m) => m.animal)).size).toBe(2);
    expect(room.hostId).toBe((await waitFor(a, 'hello')).playerId);

    const c = client('Cho');
    const rooms = await waitFor(c, 'lobby:rooms', (r) => r.length === 1);
    expect(rooms[0]).toMatchObject({ name: 'The Den', host: 'Ann', players: 2, maxPlayers: 13, status: 'waiting' });
  });

  it('only lets the host start, and only with 2 or more players', async () => {
    await start();
    const solo = client('Solo');
    await waitFor(solo, 'hello');
    solo.emit('room:create', { name: 'Alone' });
    await waitFor(solo, 'room:state', (r) => r !== null);
    solo.emit('game:start');
    expect((await waitFor(solo, 'error')).reason).toMatch(/at least 2/);

    const { b } = await twoInRoom();
    b.emit('game:start');
    expect((await waitFor(b, 'error')).reason).toMatch(/host/);
  });

  it('marks a room as playing and refuses new players', async () => {
    await start();
    const { a, b, room } = await twoInRoom();
    await startGame(a, b);
    const c = client('Cho');
    await waitFor(c, 'lobby:rooms', (r) => r[0]?.status === 'playing');
    c.emit('room:join', { roomId: room.id });
    expect((await waitFor(c, 'error')).reason).toMatch(/full or already playing/);
  });

  it('lets players pick a free animal only', async () => {
    await start();
    const { a, b, room } = await twoInRoom();
    const bAnimal = room.members[1]!.animal;
    a.emit('room:setAnimal', { animal: bAnimal });
    expect((await waitFor(a, 'error')).reason).toMatch(/already has/);
    a.emit('room:setAnimal', { animal: 'nope' as never });
    expect((await waitFor(a, 'error', (e) => /Unknown/.test(e.reason))).reason).toBe('Unknown animal.');
    const free = ['cat', 'dog', 'fox'].find((x) => x !== bAnimal && x !== room.members[0]!.animal)!;
    a.emit('room:setAnimal', { animal: free as never });
    await waitFor(b, 'room:state', (r) => r?.members[0]?.animal === free);
  });

  it('passes host to the next player when the host leaves', async () => {
    await start();
    const { a, b, room } = await twoInRoom();
    a.emit('room:leave');
    await waitFor(a, 'room:state', (r) => r === null);
    const after = await waitFor(b, 'room:state', (r) => r?.members.length === 1);
    expect(after!.hostId).toBe(room.members[1]!.id);
  });

  it('drops a disconnected player from a waiting room once their seat hold runs out', async () => {
    await start({ seatHoldMs: 80 });
    const { a, b } = await twoInRoom();
    b.disconnect();
    await waitFor(a, 'room:state', (r) => r?.members[1]?.connected === false);
    await waitFor(a, 'room:state', (r) => r?.members.length === 1);
  });

  it('opens an x2 table with two decks: 104 cards, the second deck marked', async () => {
    await start();
    const a = client('Ann');
    const b = client('Ben');
    await Promise.all([waitFor(a, 'hello'), waitFor(b, 'hello')]);
    a.emit('room:create', { name: 'Double', double: true });
    const listed = await waitFor(b, 'lobby:rooms', (rooms) => rooms.some((r) => r.name === 'Double'));
    const summary = listed.find((r) => r.name === 'Double')!;
    expect(summary.decks).toBe(2);
    b.emit('room:join', { roomId: summary.id });
    const room = await waitFor(a, 'room:state', (r) => r?.members.length === 2);
    expect(room!.decks).toBe(2);

    const { sa, sb } = await startGame(a, b);
    const all = [...sa.view.hand, ...sb.view.hand];
    expect(all).toHaveLength(104);
    expect(all.filter((c) => c.deck === 1)).toHaveLength(52);
    expect(sa.view.maxVisible).toBe(8);

    // With 8 of each rank, a play may show up to 8 cards.
    const [mover, moverState] = sa.view.turn === 0 ? [a, sa] : [b, sb];
    const eight = moverState.view.hand.slice(0, 8).map((c) => c.id);
    mover.emit('turn:play', { cardIds: eight, stacks: [], rank: 'A' });
    const played = await waitFor(a, 'turn:played');
    expect(played.count).toBe(8);
  });

  it('opens a normal table with one deck by default', async () => {
    await start();
    const { room } = await twoInRoom();
    expect(room.decks).toBe(1);
  });

  it('rejects a bad handshake', async () => {
    await start();
    const c = connect(`http://localhost:${server!.port}`, {
      auth: { token: 'short', name: 'X' },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    await new Promise<void>((resolve) => c.on('disconnect', () => resolve()));
  });
});

describe('playing', () => {
  it('sends each player only their own hand and never leaks face-down cards', async () => {
    await start();
    const { a, b } = await twoInRoom();
    const { sa, sb } = await startGame(a, b);
    const aIds = sa.view.hand.map((c) => c.id);
    const bIds = new Set(sb.view.hand.map((c) => c.id));
    expect(aIds.length + bIds.size).toBe(52);
    expect(aIds.some((id) => bIds.has(id))).toBe(false);
    expect(sa.seats.map((s) => s.name)).toEqual(['Ann', 'Ben']);

    // Whoever starts plays 3 cards, one stacked, and claims 2.
    const [starter, other, starterState] = sa.view.turn === 0 ? [a, b, sa] : [b, a, sb];
    const play = starterState.view.hand.slice(0, 3).map((c) => c.id);
    const before = mark(other);
    starter.emit('turn:play', { cardIds: play, stacks: [{ hidden: play[2]!, under: play[0]! }], rank: 'A' });
    const played = await waitFor(other, 'turn:played', () => true, before);
    expect(played.count).toBe(2);
    const otherState = await waitFor(other, 'game:state', (s) => s.view.poolCount === 2, before);
    expect(otherState.view.latest).toMatchObject({ count: 2, rank: 'A' });
    expect(otherState.view.canCall).toBe(true);

    // Nothing the other player received so far mentions the starter's cards.
    const starterIds = starterState.view.hand.map((c) => c.id);
    const seen = JSON.stringify(other.log);
    for (const id of starterIds) expect(seen).not.toContain(`"${id}"`);

    // Inspecting shows piles only.
    other.emit('turn:inspect');
    const look = await waitFor(other, 'turn:inspectView');
    expect(look.piles).toHaveLength(2);
    expect(JSON.stringify(look)).not.toMatch(/suit/);
    await waitFor(starter, 'turn:inspected');

    // Calling reveals all 3 cards: a stack is always a bluff.
    other.emit('turn:callBluff');
    const reveal = await waitFor(starter, 'turn:reveal');
    expect(reveal.cards.map((c) => c.id).sort()).toEqual([...play].sort());
    expect(reveal).toMatchObject({ wasBluff: true, announcedCount: 2, cardsTaken: 3 });
    const after = await waitFor(starter, 'game:state', (s) => s.view.poolCount === 0);
    expect(after.view.hand).toHaveLength(starterState.view.hand.length);
  });

  it('rejects malformed and illegal moves with an error', async () => {
    await start();
    const { a, b } = await twoInRoom();
    const { sa } = await startGame(a, b);
    const [mover, waiter] = sa.view.turn === 0 ? [a, b] : [b, a];
    mover.emit('turn:play', { cardIds: 'x' } as never);
    expect((await waitFor(mover, 'error')).reason).toMatch(/could not be read/);
    waiter.emit('turn:pass');
    expect((await waitFor(waiter, 'error')).reason).toMatch(/not your turn/);
    mover.emit('turn:pass');
    expect((await waitFor(mover, 'error', (e) => /must play/.test(e.reason))).reason).toMatch(/must play/);
  });

  it('plays for a player whose turn timer runs out', async () => {
    await start({ turnMs: 120 });
    const { a, b } = await twoInRoom();
    const { sa } = await startGame(a, b);
    expect(sa.turnMsLeft).toBeGreaterThan(0);
    const played = await waitFor(a, 'turn:played');
    expect(played.player).toBe(sa.view.turn);
    expect(played.count).toBe(1);
  });

  it('gives a reconnecting player their seat and hand back', async () => {
    await start();
    const { a, b } = await twoInRoom();
    const { sb } = await startGame(a, b);
    b.disconnect();
    await waitFor(a, 'game:state', (s) => s.seats[1]?.connected === false);

    const again = client('Ben', b.token);
    const state = await waitFor(again, 'game:state');
    expect(state.view.hand).toEqual(sb.view.hand);
    expect(state.view.seat).toBe(1);
    await waitFor(a, 'game:state', (s) => s.seats[1]?.connected === true);
  });

  it('plays a whole game against bots to the end', async () => {
    await start({ turnMs: 15 });
    const a = client('Ann');
    await waitFor(a, 'hello');
    a.emit('room:create', { name: 'Bots' });
    await waitFor(a, 'room:state', (r) => r !== null);
    a.emit('room:addBot');
    a.emit('room:addBot');
    a.emit('room:addBot');
    const room = await waitFor(a, 'room:state', (r) => r?.members.length === 4);
    expect(room!.members.filter((m) => m.bot)).toHaveLength(3);

    // Every play in a round must announce the rank the round started with.
    let roundRank: string | null = null;
    const offRank: string[] = [];
    a.on('turn:played', (p) => {
      roundRank ??= p.rank;
      if (p.rank !== roundRank) offRank.push(`${p.rank} in a round of ${roundRank}`);
    });
    a.on('turn:reveal', () => (roundRank = null));
    a.on('round:end', () => (roundRank = null));

    a.emit('game:start');
    const over = await new Promise<Payload<'game:over'>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('game never ended')), 20_000);
      a.on('game:over', (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
    expect(over.winner).toBeGreaterThanOrEqual(0);
    expect(offRank).toEqual([]);
    const final = lastState(a)!;
    expect(final.view.winner).toBe(over.winner);
    await waitFor(a, 'room:state', (r) => r?.status === 'waiting');
    expect(a.log.some((e) => e.event === 'turn:played')).toBe(true);
  }, 30_000);

  it('keeps the game going when a player leaves mid-game', async () => {
    await start({ turnMs: 60_000 });
    const { a, b } = await twoInRoom();
    const { sa } = await startGame(a, b);
    a.emit('room:addBot'); // refused mid-game
    expect((await waitFor(a, 'error')).reason).toMatch(/full or already playing/);
    b.emit('room:leave');
    await waitFor(b, 'room:state', (r) => r === null);
    // B's turns are now played automatically, so the game reaches A's turn without B acting.
    if (sa.view.turn === 1) await waitFor(a, 'turn:played', (p) => p.player === 1);
    const s = await waitFor(a, 'game:state', (st) => st.seats[1]?.connected === false);
    expect(s.seats[1]!.name).toBe('Ben');
  });
});
