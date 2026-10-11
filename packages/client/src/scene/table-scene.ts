import type { RevealMessage, RoomMember } from '@bluff/protocol';
import { Group, Quaternion, Vector2, Vector3, type Mesh } from 'three';
import { Avatar, AVATAR_Y, HEAD_HEIGHT } from './avatars.js';
import { CARD_T, makeCard, showFace } from './cards.js';
import type { Stage } from './stage.js';
import { Table } from './table.js';
import { sound } from '../audio/sound.js';
import { moveTo, setTweenSpeed, wait } from './tween.js';

interface PoolPlay {
  player: number;
  cards: Mesh[];
  center: Vector3;
  yaw: number;
  layer: number;
}

/** How far up (as a fraction of the screen) the seated view is shifted to make room for the HUD. */
const VIEW_SHIFT = 0.14;
const Y_AXIS = new Vector3(0, 1, 0);
const Z_AXIS = new Vector3(0, 0, 1);

/** Everything on and around the table, and the animations for each game moment. */
export class TableScene {
  private readonly table: Table;
  private seats: RoomMember[] = [];
  private mySeat: number | null = null;
  private avatars: (Avatar | null)[] = [];
  private fans: (Group | null)[] = [];
  private fanCounts: number[] = [];
  private plays: PoolPlay[] = [];
  private layer = 0;
  private turn: number | null = null;

  private lean = 0;
  private readonly leanPos = new Vector3();
  private readonly leanLook = new Vector3();
  /** 1 while inspecting, 0 otherwise; `lean` eases toward it every frame. */
  private leanTarget = 0;
  /** Bumped by every play, call and round end, so a delayed inspection can tell it's stale. */
  private moment = 0;
  private readonly mouse = new Vector2();
  /** The camera follows the mouse a little (a setting). */
  mouseLook = true;

  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  /** Set when you ask to inspect while animations are still running: play them out fast. */
  private hurry = false;
  private wantedPool: { count: number; latest: { player: number; count: number } | null } | null = null;

  constructor(private readonly stage: Stage) {
    this.table = new Table(stage.scene);
    stage.onFrame((dt, time) => this.update(dt, time));
    // Clicking the table (anywhere not covered by the HUD) sits you back from an inspection.
    stage.renderer.domElement.addEventListener('pointerdown', () => this.endInspect());
    addEventListener('pointermove', (e) => {
      // Mouse position across the game frame, -1..1 on each axis.
      const r = stage.renderer.domElement.getBoundingClientRect();
      const clamp = (n: number) => Math.max(-1, Math.min(1, n));
      this.mouse.set(clamp(((e.clientX - r.left) / r.width) * 2 - 1), clamp(((e.clientY - r.top) / r.height) * 2 - 1));
    });
  }

  // --- Layout ---------------------------------------------------------------

  /** You sit at angle 0, nearest the camera. The next seat clockwise sits to your left. */
  private angle(seat: number): number {
    return ((seat - (this.mySeat ?? 0)) / Math.max(1, this.seats.length)) * Math.PI * 2;
  }

  private around(angle: number, distance: number, y: number): Vector3 {
    return new Vector3(-Math.sin(angle) * distance, y, Math.cos(angle) * distance);
  }

  /** Where a seat's cards come from and go to. */
  private handSpot(seat: number): Vector3 {
    const r = this.table.radius;
    return seat === this.mySeat ? this.around(0, r + 0.2, 0.5) : this.around(this.angle(seat), r - 0.15, 0.4);
  }

  /** Seats the given players. Rebuilds avatars only when the seating actually changes. */
  setSeats(seats: RoomMember[], mySeat: number | null): void {
    const same =
      mySeat === this.mySeat &&
      seats.length === this.seats.length &&
      seats.every((s, i) => s.id === this.seats[i]?.id && s.animal === this.seats[i]?.animal);
    this.seats = seats.map((s) => ({ ...s }));
    if (same) return;

    this.mySeat = mySeat;
    for (const a of this.avatars) a?.dispose();
    for (const f of this.fans) f?.removeFromParent();
    this.clearPool();
    this.table.setRadius(seats.length ? Math.min(4, Math.max(2, 1.5 + seats.length * 0.2)) : 2.2);

    const r = this.table.radius;
    this.avatars = seats.map((s, i) => {
      if (i === mySeat) return null;
      const avatar = new Avatar(s.animal);
      avatar.root.position.copy(this.around(this.angle(i), r + 0.55, AVATAR_Y));
      avatar.root.lookAt(0, AVATAR_Y, 0);
      this.stage.scene.add(avatar.root);
      return avatar;
    });
    this.fans = seats.map(() => null);
    this.fanCounts = [];
    this.setTurn(this.turn);
  }

  setTurn(seat: number | null): void {
    // Your turn arrives with one heavy heartbeat.
    if (seat !== null && seat === this.mySeat && this.turn !== seat) {
      this.stage.effects.heartbeat();
      sound.heartbeat(1);
    }
    this.turn = seat;
    this.avatars.forEach((a, i) => a?.setLit(i === seat));
  }

  /** Fans of card backs in front of each other player. Seats without a count get no fan. */
  setHandCounts(counts: number[]): void {
    this.seats.forEach((_, seat) => {
      const count = counts[seat] ?? 0;
      if (seat === this.mySeat || (this.fanCounts[seat] ?? 0) === count) return;
      this.fanCounts[seat] = count;
      this.fans[seat]?.removeFromParent();
      this.fans[seat] = count > 0 ? this.buildFan(seat, count) : null;
    });
  }

  private buildFan(seat: number, count: number): Group {
    const fan = new Group();
    // Held low at the table edge, below the animal's face.
    fan.position.copy(this.around(this.angle(seat), this.table.radius + 0.05, 0.24));
    fan.lookAt(0, 0.24, 0);
    const shown = Math.min(count, 12);
    const spread = Math.min(1.3, shown * 0.1);
    for (let i = 0; i < shown; i++) {
      const a = shown === 1 ? 0 : -spread / 2 + (spread * i) / (shown - 1);
      const card = makeCard();
      card.scale.setScalar(0.6);
      card.position.set(Math.sin(a) * 0.18, Math.cos(a) * 0.18 - 0.18, i * 0.006);
      card.rotation.set(Math.PI / 2 - 0.6, -a, 0);
      fan.add(card);
    }
    this.stage.scene.add(fan);
    return fan;
  }

  // --- Pool -----------------------------------------------------------------

  /** Brings the pool in line with the server once no animation is running. */
  syncPool(count: number, latest: { player: number; count: number } | null): void {
    this.wantedPool = { count, latest };
    if (this.pending === 0) this.applyPoolSync();
  }

  private applyPoolSync(): void {
    const wanted = this.wantedPool;
    if (!wanted) return;
    const have = this.plays.reduce((n, p) => n + p.cards.length, 0);
    if (have === wanted.count && (this.plays.at(-1)?.cards.length ?? 0) === (wanted.latest?.count ?? 0)) return;
    this.clearPool();
    let older = wanted.count - (wanted.latest?.count ?? 0);
    while (older > 0) {
      const n = Math.min(3, older);
      this.placePlay(this.newPlay(-1, n));
      older -= n;
    }
    if (wanted.latest) this.placePlay(this.newPlay(wanted.latest.player, wanted.latest.count));
  }

  private newPlay(player: number, count: number): PoolPlay {
    const i = this.plays.length;
    const angle = i * 2.39996; // golden angle spreads plays around the centre
    const dist = 0.1 + 0.42 * ((i * 0.618) % 1);
    const play: PoolPlay = {
      player,
      cards: Array.from({ length: count }, () => makeCard()),
      center: new Vector3(Math.cos(angle) * dist, 0, Math.sin(angle) * dist),
      yaw: Math.random() * Math.PI,
      layer: this.layer++,
    };
    this.plays.push(play);
    return play;
  }

  private slot(play: PoolPlay, i: number, total: number): { pos: Vector3; quat: Quaternion } {
    const offset = new Vector3((i - (total - 1) / 2) * 0.17, 0, (Math.random() - 0.5) * 0.04).applyAxisAngle(Y_AXIS, play.yaw);
    const pos = play.center.clone().add(offset);
    pos.y = CARD_T / 2 + play.layer * CARD_T * 1.1;
    const quat = new Quaternion().setFromAxisAngle(Y_AXIS, play.yaw + (Math.random() - 0.5) * 0.25);
    return { pos, quat };
  }

  private placePlay(play: PoolPlay): void {
    play.cards.forEach((card, i) => {
      const { pos, quat } = this.slot(play, i, play.cards.length);
      card.position.copy(pos);
      card.quaternion.copy(quat);
      this.stage.scene.add(card);
    });
  }

  private clearPool(): void {
    for (const p of this.plays) for (const c of p.cards) c.removeFromParent();
    this.plays = [];
    this.layer = 0;
  }

  // --- Game moments -----------------------------------------------------------

  /**
   * Runs animation steps one after another. If they fall behind (more than two waiting, or you
   * asked to inspect), everything plays at high speed until the table has caught up.
   */
  private enqueue(step: () => Promise<void>): void {
    this.pending++;
    this.paceQueue();
    this.queue = this.queue
      .then(step)
      .catch((err: unknown) => console.error(err))
      .finally(() => {
        if (--this.pending === 0) {
          this.hurry = false;
          this.applyPoolSync();
        }
        this.paceQueue();
      });
  }

  private paceQueue(): void {
    setTweenSpeed(this.hurry || this.pending > 2 ? 10 : 1);
  }

  /** Cards slide face down from the player into the light. */
  played(seat: number, count: number): void {
    this.moment++;
    this.endInspect(); // the play you were inspecting is no longer the latest
    this.enqueue(async () => {
      const play = this.newPlay(seat, count);
      const from = this.handSpot(seat);
      await Promise.all(
        play.cards.map((card, i) => {
          const { pos, quat } = this.slot(play, i, count);
          card.position.copy(from);
          this.stage.scene.add(card);
          sound.cardSlide((i * 70) / 1000);
          return moveTo(card, { to: pos, quaternion: quat, ms: 420, delay: i * 70, arc: 0.25 });
        }),
      );
    });
  }

  /**
   * The camera leans in over the latest play and the piles show their thickness. It stays there
   * until you sit back, or the play stops being the latest (a new play, a call, the round ends).
   */
  inspectMine(piles: number[]): void {
    // Wait for any animation still landing the play on the table (hurrying it along so the lean
    // starts promptly); give up if the table has moved on by then.
    const moment = this.moment;
    if (this.pending > 0) this.hurry = true;
    this.enqueue(async () => {
      const play = this.plays.at(-1);
      if (!play || moment !== this.moment) return;
      play.cards.forEach((card, i) => {
        const t = piles[i] ?? 1;
        card.scale.y = 2.6 * t;
        card.position.y = play.layer * CARD_T * 1.1 + (CARD_T * card.scale.y) / 2;
      });
      const toMe = this.around(0, 1, 0);
      // High above the cards, aimed a little below them: the pile lands between about 11% and
      // 36% down the screen, fully in view and clear of the HUD (checked with the real camera maths).
      this.leanLook.copy(play.center).setY(-0.3);
      this.leanPos.copy(play.center).addScaledVector(toMe, 0.75).setY(0.85);
      this.leanTarget = 1;
      sound.whoosh();
    });
  }

  /** Sit back from an inspection. Safe to call when not inspecting. */
  endInspect(): void {
    if (this.leanTarget === 0) return;
    this.leanTarget = 0;
    for (const p of this.plays) {
      for (const c of p.cards) {
        c.scale.y = 1;
        c.position.y = CARD_T / 2 + p.layer * CARD_T * 1.1;
      }
    }
  }

  get inspecting(): boolean {
    return this.leanTarget === 1;
  }

  otherInspected(seat: number): void {
    void this.avatars[seat]?.lean();
    sound.whoosh(0.35);
  }

  /** The lamp flickers, the called cards flip face up, then the pool goes to whoever lost the call. */
  revealed(msg: RevealMessage): void {
    this.moment++;
    this.endInspect();
    this.enqueue(async () => {
      const fx = this.stage.effects;
      const play = this.plays.at(-1) ?? this.newPlay(msg.player, 0);
      void this.table.flicker(900, fx.intensity);
      sound.zap();
      sound.crackle(900);
      fx.glitch(0.9);
      fx.shakeScreen(0.05);

      // Hidden cards slide out from under the visible ones.
      const visible = play.cards.length;
      for (let i = visible; i < msg.cards.length; i++) {
        const card = makeCard();
        const under = play.cards[i % Math.max(1, visible)];
        if (under) card.position.copy(under.position).setY(under.position.y - CARD_T / 2);
        else card.position.copy(play.center);
        this.stage.scene.add(card);
        play.cards.push(card);
      }
      await Promise.all(
        play.cards.map((card, i) => {
          const { pos, quat } = this.slot(play, i, play.cards.length);
          return moveTo(card, { to: pos, quaternion: quat, ms: 350 });
        }),
      );

      await Promise.all(
        play.cards.map((card, i) => {
          const face = msg.cards[i];
          if (face) showFace(card, face);
          sound.cardFlip((i * 110) / 1000);
          const flipped = card.quaternion.clone().multiply(new Quaternion().setFromAxisAngle(Z_AXIS, Math.PI));
          return moveTo(card, { to: card.position.clone(), quaternion: flipped, ms: 380, delay: i * 110, arc: 0.2 });
        }),
      );

      // Caught: the alarm goes off. A false alarm just stutters. Losing the call breaks your screen.
      if (msg.wasBluff) {
        fx.alarm(2800);
        sound.alarm();
      } else {
        fx.glitch(0.5);
        sound.falseAlarm();
      }
      if (msg.loser === this.mySeat) {
        fx.breakScreen();
        sound.glassBreak();
      }

      const winner = msg.loser === msg.caller ? msg.player : msg.caller;
      this.avatars[msg.loser]?.react('gesture-negative');
      this.avatars[winner]?.react('gesture-positive');
      await wait(2000);
      sound.sweep();
      await this.sweep(this.handSpot(msg.loser), 0.15);
    });
  }

  /** Nobody called: the pool is swept out of the light into the dark. */
  roundEnded(): void {
    this.moment++;
    this.endInspect();
    this.enqueue(async () => {
      this.stage.effects.darken();
      sound.sweep();
      sound.darkness();
      const cards = this.plays.flatMap((p) => p.cards);
      await Promise.all(
        cards.map((card, i) => {
          const out = card.position.clone().setY(0);
          if (out.lengthSq() < 1e-4) out.set(Math.random() - 0.5, 0, Math.random() - 0.5);
          out.normalize().multiplyScalar(this.table.radius + 4).setY(-1.2);
          return moveTo(card, { to: out, ms: 750, delay: i * 25 });
        }),
      );
      this.clearPool();
    });
  }

  gameOver(winner: number): void {
    this.endInspect();
    this.enqueue(async () => {
      this.avatars.forEach((a, i) => (i === winner ? a?.dance() : a?.react('gesture-negative')));
      const fx = this.stage.effects;
      if (winner === this.mySeat) {
        fx.flash(1);
        sound.win();
      } else {
        fx.breakScreen();
        fx.darken();
        sound.glassBreak();
        sound.lose();
      }
    });
  }

  /** Back to idle and an empty table, for a new game. */
  reset(): void {
    this.endInspect();
    this.clearPool();
    for (const a of this.avatars) a?.calm();
  }

  private async sweep(to: Vector3, arc: number): Promise<void> {
    const cards = this.plays.flatMap((p) => p.cards);
    await Promise.all(cards.map((card, i) => moveTo(card, { to, ms: 450, delay: i * 30, arc })));
    this.clearPool();
  }

  // --- Frame ------------------------------------------------------------------

  /** Where a seat's head is in the game frame, as fractions (0..1) across and down, for name labels. */
  project(seat: number): { x: number; y: number; visible: boolean } {
    const avatar = this.avatars[seat];
    if (!avatar) return { x: 0, y: 0, visible: false };
    const v = avatar.root.position.clone().setY(avatar.root.position.y + HEAD_HEIGHT).project(this.stage.camera);
    // In front of the camera counts as visible; labels for seats just off-screen get pinned to the edge.
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2, visible: v.z < 1 };
  }

  private update(dt: number, time: number): void {
    this.table.update(time);
    this.table.setAlarm(this.stage.effects.alarmLevel, time);
    for (const a of this.avatars) a?.update(dt, time);

    const cam = this.stage.camera;
    const t = time / 1000;
    // Seated, the HUD fills the bottom of the screen: shift the picture up so faces stay clear of it.
    // setViewOffset also sets aspect = fullWidth / fullHeight, so pass the current aspect to keep it 16:9.
    const shift = this.mySeat === null ? 0 : VIEW_SHIFT;
    const current = cam.view?.enabled ? cam.view.offsetY : 0;
    if (current !== shift) {
      if (shift) cam.setViewOffset(cam.aspect, 1, 0, shift, cam.aspect, 1);
      else cam.clearViewOffset();
    }
    if (this.mySeat === null) {
      // Lobby: drift slowly around the empty table.
      const a = t * 0.06;
      cam.position.set(Math.sin(a) * 4.4, 1.9, Math.cos(a) * 4.4);
      cam.lookAt(0, -0.1, 0);
      return;
    }

    const r = this.table.radius;
    const pos = new Vector3(Math.sin(t * 0.4) * 0.03, 1.15 + Math.sin(t * 0.7) * 0.015, r + 0.9);
    const look = new Vector3(0, 0.15, -0.6);
    // Look around a little with the mouse.
    if (this.mouseLook) {
      look.sub(pos).applyAxisAngle(Y_AXIS, -this.mouse.x * 0.35).add(pos);
      look.y -= this.mouse.y * 0.5;
    }
    // Ease in and out of an inspection.
    this.lean += (this.leanTarget - this.lean) * Math.min(1, dt * 5);
    if (Math.abs(this.leanTarget - this.lean) < 0.002) this.lean = this.leanTarget;
    if (this.lean > 0) {
      pos.lerp(this.leanPos, this.lean);
      look.lerp(this.leanLook, this.lean);
    }
    pos.add(this.stage.effects.shake);
    cam.position.copy(pos);
    cam.lookAt(look);

    // On your turn, everyone at the table turns to stare at you.
    const watchMe = this.turn !== null && this.turn === this.mySeat;
    for (const a of this.avatars) a?.lookAt(watchMe ? cam.position : null);
  }
}
