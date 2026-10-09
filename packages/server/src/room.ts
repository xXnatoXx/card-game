import {
  applyAction,
  createGame,
  inspect,
  playerView,
  timeoutAction,
  type Action,
  type GameEvent,
  type GameState,
  type InspectView,
  type Seat,
} from '@bluff/rules';
import {
  ANIMALS,
  MAX_ROOM_PLAYERS,
  type Animal,
  type PlayPayload,
  type RoomMember,
  type RoomState,
  type RoomStatus,
  type RoomSummary,
} from '@bluff/protocol';
import { randomUUID } from 'node:crypto';
import { chooseCall, chooseTurn, wantsInspect } from './bot.js';
import type { BluffServer, Human, ServerOptions } from './types.js';

interface Member {
  id: string;
  name: string;
  animal: Animal;
  bot: boolean;
  /** Null for bots and for people who left during a game. */
  human: Human | null;
  /** True once a person left mid-game or their seat hold ran out: their turns are played for them. */
  away: boolean;
}

export interface RoomContext {
  io: BluffServer;
  options: ServerOptions;
  roomsChanged(): void;
  roomClosed(room: Room): void;
}

/** Error text for the player, or null on success. */
type Outcome = string | null;

export class Room {
  readonly channel: string;
  readonly createdAt = Date.now();
  private readonly members: Member[] = [];
  private hostId: string;
  private game: GameState | null = null;
  /** Seat order of the current or last game. */
  private seats: Member[] = [];
  private playing = false;
  private closed = false;
  private turnTimer: NodeJS.Timeout | null = null;
  private turnEndsAt: number | null = null;
  private readonly botTimers = new Set<NodeJS.Timeout>();
  /** Counts plays, so a delayed bot call can tell whether its play is still the latest. */
  private playSerial = 0;

  constructor(
    readonly id: string,
    readonly name: string,
    host: Human,
    private readonly ctx: RoomContext,
    /** 1, or 2 for x2 mode. */
    readonly decks = 1,
  ) {
    this.channel = `room:${id}`;
    this.hostId = host.id;
  }

  get status(): RoomStatus {
    if (this.closed) return 'closed';
    if (this.playing) return 'playing';
    return this.members.length >= MAX_ROOM_PLAYERS ? 'full' : 'waiting';
  }

  summary(): RoomSummary {
    const host = this.members.find((m) => m.id === this.hostId);
    return {
      id: this.id,
      name: this.name,
      host: host?.name ?? '?',
      players: this.members.length,
      maxPlayers: MAX_ROOM_PLAYERS,
      status: this.status,
      decks: this.decks,
    };
  }

  state(): RoomState {
    return {
      id: this.id,
      name: this.name,
      hostId: this.hostId,
      status: this.status,
      decks: this.decks,
      members: this.members.map(info),
    };
  }

  // --- Membership -----------------------------------------------------------

  addHuman(h: Human): Outcome {
    if (this.status !== 'waiting') return 'That room is full or already playing.';
    this.members.push({ id: h.id, name: h.name, animal: this.freeAnimal(), bot: false, human: h, away: false });
    h.room = this;
    if (h.socket) {
      void h.socket.leave('lobby');
      void h.socket.join(this.channel);
    }
    this.changed();
    return null;
  }

  leave(h: Human): void {
    const m = this.memberOf(h);
    h.room = null;
    if (h.socket) {
      void h.socket.leave(this.channel);
      void h.socket.join('lobby');
      h.socket.emit('room:state', null);
    }
    if (!m) return;
    if (this.playing) {
      m.human = null;
      m.away = true;
    } else {
      this.members.splice(this.members.indexOf(m), 1);
    }
    this.membershipChanged(m);
  }

  disconnected(h: Human): void {
    if (!this.memberOf(h)) return;
    this.changed();
    this.sendStates();
  }

  /** The seat hold ran out without the player coming back. */
  holdExpired(h: Human): void {
    const m = this.memberOf(h);
    if (!m) return;
    if (!this.playing) return this.leave(h);
    m.away = true;
    this.membershipChanged(m);
  }

  reconnected(h: Human): void {
    const m = this.memberOf(h);
    if (!m) {
      h.room = null;
      return;
    }
    const wasAway = m.away;
    m.away = false;
    if (h.socket) {
      void h.socket.leave('lobby');
      void h.socket.join(this.channel);
    }
    if (this.hostId !== h.id && !this.activeMember(this.hostId)) this.hostId = h.id;
    this.changed();
    if (this.playing && this.game) {
      if (wasAway && this.seats[this.game.turn] === m) this.scheduleTurn();
      this.sendStates();
    }
  }

  renamed(h: Human): void {
    const m = this.memberOf(h);
    if (!m || this.playing) return;
    m.name = h.name;
    this.changed();
  }

  setAnimal(h: Human, animal: Animal): Outcome {
    const m = this.memberOf(h);
    if (!m) return 'You are not in this room.';
    if (this.playing) return 'You cannot change animals during a game.';
    if (this.members.some((o) => o !== m && o.animal === animal)) return 'Someone else already has that animal.';
    m.animal = animal;
    this.changed();
    return null;
  }

  addBot(byId: string): Outcome {
    if (byId !== this.hostId) return 'Only the host can add bots.';
    if (this.status !== 'waiting') return 'The room is full or already playing.';
    const animal = this.freeAnimal();
    const name = `${animal[0]!.toUpperCase()}${animal.slice(1)} Bot`;
    this.members.push({ id: `bot-${randomUUID()}`, name, animal, bot: true, human: null, away: false });
    this.changed();
    return null;
  }

  removeBot(byId: string, memberId: string): Outcome {
    if (byId !== this.hostId) return 'Only the host can remove bots.';
    if (this.playing) return 'You cannot remove bots during a game.';
    const i = this.members.findIndex((m) => m.id === memberId && m.bot);
    if (i < 0) return 'There is no such bot.';
    this.members.splice(i, 1);
    this.changed();
    return null;
  }

  // --- Game -----------------------------------------------------------------

  start(byId: string): Outcome {
    if (byId !== this.hostId) return 'Only the host can start the game.';
    if (this.playing) return 'The game has already started.';
    if (this.members.length < 2) return 'You need at least 2 players.';
    this.seats = [...this.members];
    // Up to 4 visible cards per deck: with x2 mode's 8 of each rank, a play can show 8.
    this.game = createGame({
      players: this.seats.length,
      rng: this.ctx.options.rng,
      config: { decks: this.decks, maxVisibleCards: 4 * this.decks },
    });
    this.playing = true;
    this.playSerial = 0;
    this.changed();
    this.scheduleTurn();
    this.sendStates();
    return null;
  }

  humanAction(h: Human, kind: 'play' | 'pass' | 'callBluff', payload?: PlayPayload): Outcome {
    const seat = this.seatOf(h);
    if (seat === null) return 'You are not playing in a game.';
    if (kind === 'play') {
      if (!payload) return 'Bad play.';
      return this.apply({ type: 'play', player: seat, cardIds: payload.cardIds, stacks: payload.stacks, rank: payload.rank });
    }
    return this.apply({ type: kind, player: seat });
  }

  inspectFor(h: Human): Outcome {
    const seat = this.seatOf(h);
    if (seat === null || !this.game) return 'You are not playing in a game.';
    const result = inspect(this.game, seat);
    if (!result.ok) return result.error.message;
    h.socket?.emit('turn:inspectView', result.value);
    this.ctx.io.to(this.channel).emit('turn:inspected', { by: seat });
    return null;
  }

  shutdown(): void {
    this.clearTimers();
  }

  private apply(action: Action): Outcome {
    if (!this.game || !this.playing) return 'No game is running.';
    const result = applyAction(this.game, action, this.ctx.options.rng);
    if (!result.ok) return result.error.message;
    this.game = result.value.state;
    for (const event of result.value.events) this.emit(event);

    if (this.game.winner !== null) {
      this.finish();
      return null;
    }
    this.scheduleTurn();
    this.sendStates();
    if (action.type === 'play') this.scheduleBotCalls();
    return null;
  }

  private emit(event: GameEvent): void {
    const to = this.ctx.io.to(this.channel);
    switch (event.type) {
      case 'played':
        this.playSerial++;
        return void to.emit('turn:played', event);
      case 'passed':
        return void to.emit('turn:passed', event);
      case 'revealed':
        return void to.emit('turn:reveal', event);
      case 'roundEnded':
        return void to.emit('round:end', event);
      case 'gameOver':
        return void to.emit('game:over', event);
    }
  }

  private finish(): void {
    this.clearTimers();
    this.playing = false;
    this.sendStates();
    // People who left or never came back lose their place once the game is over.
    for (const m of [...this.members]) {
      if (m.bot || (m.human && !m.away)) continue;
      if (m.human?.room === this) m.human.room = null;
      this.members.splice(this.members.indexOf(m), 1);
    }
    if (!this.members.some((m) => isActiveHuman(m))) return this.close();
    if (!this.activeMember(this.hostId)) this.transferHost();
    this.changed();
  }

  /** Starts the right timer for whoever's turn it is. Called after every change of turn. */
  private scheduleTurn(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
    this.turnEndsAt = null;
    const game = this.game;
    if (!game || !this.playing || game.winner !== null) return;

    const m = this.seats[game.turn]!;
    const { options } = this.ctx;
    if (m.bot) {
      this.turnTimer = setTimeout(() => this.botTurn(), between(options.botTurnMs, options.rng));
    } else if (!isActiveHuman(m)) {
      this.turnTimer = setTimeout(() => this.autoAct(), options.autoActDelayMs);
    } else {
      this.turnEndsAt = Date.now() + options.turnMs;
      this.turnTimer = setTimeout(() => this.autoAct(), options.turnMs);
    }
  }

  private autoAct(): void {
    if (!this.game) return;
    const action = timeoutAction(this.game, this.ctx.options.rng);
    if (action) this.apply(action);
  }

  private botTurn(): void {
    const game = this.game;
    if (!game) return;
    const seat = game.turn;
    const choice = chooseTurn(playerView(game, seat), this.ctx.options.rng);
    const error =
      choice.type === 'pass'
        ? this.apply({ type: 'pass', player: seat })
        : this.apply({ type: 'play', player: seat, ...choice.payload });
    if (error) this.autoAct();
  }

  private scheduleBotCalls(): void {
    const game = this.game;
    const latest = game?.pool.at(-1);
    if (!game || !latest) return;
    const serial = this.playSerial;
    const { options } = this.ctx;
    const perRank = 4 * game.config.decks;

    this.seats.forEach((m, seat) => {
      if (!m.bot || seat === latest.player) return;
      this.botTimer(between(options.botCallMs, options.rng), () => {
        if (!this.game || !this.playing || this.playSerial !== serial) return;
        const view = playerView(this.game, seat);
        if (!view.canCall) return;
        let look: InspectView | null = null;
        if (wantsInspect(view, options.rng)) {
          const result = inspect(this.game, seat);
          if (result.ok) {
            look = result.value;
            this.ctx.io.to(this.channel).emit('turn:inspected', { by: seat });
          }
        }
        if (chooseCall(view, look, options.rng, perRank)) this.apply({ type: 'callBluff', player: seat });
      });
    });
  }

  private sendStates(): void {
    const game = this.game;
    if (!game) return;
    const seats = this.seats.map(info);
    const turnMsLeft = this.turnEndsAt === null ? null : Math.max(0, this.turnEndsAt - Date.now());
    this.seats.forEach((m, seat) => {
      if (m.human?.socket && m.human.room === this) {
        m.human.socket.emit('game:state', { view: playerView(game, seat), seats, turnMsLeft });
      }
    });
  }

  // --- Helpers --------------------------------------------------------------

  private membershipChanged(m: Member): void {
    if (!this.members.some((o) => isActiveHuman(o))) return this.close();
    if (!this.activeMember(this.hostId)) this.transferHost();
    this.changed();
    if (this.playing && this.game) {
      if (this.seats[this.game.turn] === m) this.scheduleTurn();
      this.sendStates();
    }
  }

  private transferHost(): void {
    const next = this.members.find((m) => isActiveHuman(m) && m.human?.socket) ?? this.members.find(isActiveHuman);
    if (next) this.hostId = next.id;
  }

  private activeMember(id: string): Member | undefined {
    return this.members.find((m) => m.id === id && isActiveHuman(m));
  }

  private memberOf(h: Human): Member | undefined {
    return this.members.find((m) => m.human === h);
  }

  private seatOf(h: Human): Seat | null {
    if (!this.playing) return null;
    const seat = this.seats.findIndex((m) => m.human === h);
    return seat < 0 ? null : seat;
  }

  private freeAnimal(): Animal {
    const taken = new Set(this.members.map((m) => m.animal));
    const free = ANIMALS.filter((a) => !taken.has(a));
    return free[Math.floor(this.ctx.options.rng() * free.length)] ?? 'cat';
  }

  private botTimer(ms: number, fn: () => void): void {
    const timer = setTimeout(() => {
      this.botTimers.delete(timer);
      fn();
    }, ms);
    this.botTimers.add(timer);
  }

  private clearTimers(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
    this.turnEndsAt = null;
    for (const t of this.botTimers) clearTimeout(t);
    this.botTimers.clear();
  }

  private changed(): void {
    if (this.closed) return;
    this.ctx.io.to(this.channel).emit('room:state', this.state());
    this.ctx.roomsChanged();
  }

  private close(): void {
    this.closed = true;
    this.playing = false;
    this.clearTimers();
    for (const m of this.members) {
      const h = m.human;
      if (!h || h.room !== this) continue;
      h.room = null;
      if (h.socket) {
        void h.socket.leave(this.channel);
        void h.socket.join('lobby');
        h.socket.emit('room:state', null);
      }
    }
    this.ctx.roomClosed(this);
  }
}

function isActiveHuman(m: Member): boolean {
  return m.human !== null && !m.away;
}

function info(m: Member): RoomMember {
  return {
    id: m.id,
    name: m.name,
    animal: m.animal,
    connected: m.bot || (m.human?.socket != null && !m.away),
    bot: m.bot,
  };
}

function between([min, max]: [number, number], rng: () => number): number {
  return min + rng() * (max - min);
}
