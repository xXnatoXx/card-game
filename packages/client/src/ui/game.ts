import { RANKS, type Rank } from '@bluff/rules';
import { socket, store } from '../net.js';
import type { TableScene } from '../scene/table-scene.js';
import { SUIT_SYMBOL } from '../scene/cards.js';
import { cardFace, claim, h, present, sortHand, type Screen } from './dom.js';
import { settingsButton } from './settings-panel.js';
import type { Feed, FeedItem } from './feed.js';

/** Cards per row in your hand before it wraps to a new row. */
const HAND_ROW = 8;

/** The in-game HUD: your hand, building a play (with stacking), the actions, and what just happened. */
export class GameScreen implements Screen {
  readonly el: HTMLElement;
  private readonly top = h('div', { class: 'hud-top' });
  private readonly log = h('ol', { class: 'log' });
  private readonly banner = h('div', { class: 'banner' });
  private readonly reveal = h('div', { class: 'reveal' });
  private readonly status = h('div', { class: 'status' });
  private readonly timerFill = h('div', { class: 'timer-fill' });
  private readonly timer = h('div', { class: 'timer' }, this.timerFill);
  private readonly staging = h('div', { class: 'staging' });
  private readonly ranks = h('div', { class: 'ranks' });
  private readonly actions = h('div', { class: 'actions' });
  private readonly hand = h('div', { class: 'hand' });
  private readonly over = h('div', { class: 'over hidden' });
  /** Shown while leaning in: how many cards the whole pool holds, and the play being inspected. */
  private readonly inspectInfo = h('div', { class: 'inspect-info hidden' });

  /** Selected card ids, in the order they will be played. */
  private selected: string[] = [];
  /** Hidden card id -> id of the visible card it is tucked under. */
  private readonly stacks = new Map<string, string>();
  private rank: Rank = 'A';
  private rankTouched = false;
  /** A card waiting for the player to pick what to hide it under. */
  private stackPick: string | null = null;
  private menuFor: string | null = null;
  private wasMyTurn = false;
  private wasInspecting = false;
  private turnTotal = 30_000;
  private bannerTimer = 0;
  private revealTimer = 0;
  private readonly interval: number;
  private readonly offFeed: () => void;

  constructor(
    feed: Feed,
    private readonly scene: TableScene,
    private readonly closeResults: () => void,
  ) {
    this.el = h(
      'div',
      { class: 'game' },
      this.top,
      this.log,
      this.banner,
      this.reveal,
      h(
        'div',
        { class: 'bottom' },
        // Whose turn it is on top, then the actions, the rank, the cards you're building a play from, your hand.
        this.status,
        this.timer,
        this.actions,
        this.ranks,
        this.staging,
        this.hand,
      ),
      this.inspectInfo,
      this.over,
    );
    this.offFeed = feed.on((item) => this.onFeed(item));
    addEventListener('keydown', this.onKey);
    this.interval = window.setInterval(() => this.tick(), 100);
  }

  destroy(): void {
    this.offFeed();
    removeEventListener('keydown', this.onKey);
    clearInterval(this.interval);
    clearTimeout(this.bannerTimer);
    clearTimeout(this.revealTimer);
    this.el.remove();
  }

  // --- State ------------------------------------------------------------------

  private name(seat: number): string {
    const game = store.game;
    if (game && seat === game.view.seat) return 'You';
    return game?.seats[seat]?.name ?? '?';
  }

  /** The game's limits: 4 visible cards per deck (8 in x2 mode), and 1 hidden under each. */
  private get maxVisible(): number {
    return store.game?.view.maxVisible ?? 4;
  }

  private get maxHiddenPerVisible(): number {
    return store.game?.view.maxHiddenPerVisible ?? 1;
  }

  private get visibleIds(): string[] {
    return this.selected.filter((id) => !this.stacks.has(id));
  }

  private hiddenUnder(id: string): string[] {
    return [...this.stacks].filter(([, under]) => under === id).map(([hidden]) => hidden);
  }

  private toggle(id: string): void {
    if (this.selected.includes(id)) this.drop(id);
    else this.selected.push(id);
    this.stackPick = null;
    this.menuFor = null;
    this.update();
  }

  private drop(id: string): void {
    this.selected = this.selected.filter((s) => s !== id);
    this.stacks.delete(id);
    for (const hidden of this.hiddenUnder(id)) this.stacks.delete(hidden);
  }

  update(): void {
    const game = store.game;
    if (!game) return;
    const v = game.view;

    // Forget cards that left the hand, and stacks that no longer make sense.
    const inHand = new Set(v.hand.map((c) => c.id));
    this.selected = this.selected.filter((id) => inHand.has(id));
    for (const [hidden, under] of this.stacks) {
      if (!inHand.has(hidden) || !inHand.has(under)) this.stacks.delete(hidden);
    }

    const myTurn = v.canPlay;
    if (myTurn && !this.wasMyTurn) {
      this.rankTouched = false;
      if (store.turnDeadline) this.turnTotal = Math.max(1000, store.turnDeadline - Date.now());
    }
    this.wasMyTurn = myTurn;

    if (v.roundRank) {
      this.rank = v.roundRank; // the round's starter chose it; everyone follows
    } else if (!this.rankTouched) {
      const counts = new Map<Rank, number>();
      for (const id of this.visibleIds) {
        const card = v.hand.find((c) => c.id === id);
        if (card) counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
      }
      const best = [...counts].sort((a, b) => b[1] - a[1])[0];
      if (best) this.rank = best[0];
    }

    this.renderTop();
    this.renderStatus();
    this.renderStaging();
    this.renderRanks();
    this.renderActions();
    this.renderHand();
    this.renderInspectInfo();
    if (v.winner === null) this.over.classList.add('hidden');
  }

  private renderInspectInfo(): void {
    const v = store.game?.view;
    const show = !!v && this.scene.inspecting;
    this.inspectInfo.classList.toggle('hidden', !show);
    if (!show || !v) return;
    const n = v.poolCount;
    this.inspectInfo.replaceChildren(
      ...present(
        h('div', { class: 'inspect-count' }, String(n)),
        h('div', { class: 'inspect-label' }, `card${n === 1 ? '' : 's'} in the pool`),
        v.latest ? h('div', { class: 'inspect-latest' }, `${this.name(v.latest.player)}: "${claim(v.latest.count, v.latest.rank)}"`) : null,
      ),
    );
  }

  // --- Rendering --------------------------------------------------------------

  private renderTop(): void {
    const v = store.game!.view;
    this.top.replaceChildren(...present(
      h('span', { title: 'Face-down cards in the pool' }, `▣ ${v.poolCount}`),
      v.roundRank ? h('span', { class: 'latest', title: "This round's rank" }, v.roundRank) : null,
      settingsButton(),
      h(
        'button',
        {
          class: 'tiny',
          title: 'Leave the table',
          onclick: () => {
            const playing = store.room?.status === 'playing';
            if (!playing || confirm('Leave the game? Your turns will be played for you.')) socket.emit('room:leave');
          },
        },
        '✕',
      ),
    ));
  }

  private renderStatus(): void {
    const v = store.game!.view;
    let text: string;
    if (v.winner !== null) text = v.winner === v.seat ? 'You won!' : `${this.name(v.winner)} won.`;
    else if (this.stackPick) text = 'Click the card to hide it under. (Esc cancels)';
    else if (v.canPlay) text = v.canPass ? 'Your turn: play cards, or pass.' : 'Your turn. You start this round, so you must play.';
    else text = `Waiting for ${this.name(v.turn)}…${v.canCall ? '  You can inspect or call the last play.' : ''}`;
    this.status.textContent = text;
    this.status.classList.toggle('mine', v.canPlay);
  }

  private renderStaging(): void {
    const v = store.game!.view;
    const byId = new Map(v.hand.map((c) => [c.id, c]));
    const visible = this.visibleIds;
    if (this.selected.length === 0) {
      this.staging.replaceChildren();
      return;
    }

    const groups = visible.map((id) => {
      const card = byId.get(id)!;
      const hidden = this.hiddenUnder(id);
      const isTarget = this.stackPick !== null && this.stackPick !== id && hidden.length < this.maxHiddenPerVisible;
      const menu = this.menuFor === id ? this.menuForVisible(id, visible) : hidden.includes(this.menuFor ?? '') ? this.menuForHidden(this.menuFor!) : null;
      return h(
        'div',
        { class: 'staged' },
        ...hidden.map((hid) =>
          cardFace(byId.get(hid)!, {
            class: 'tucked',
            title: 'Hidden under this card',
            onclick: (e: Event) => {
              e.stopPropagation();
              this.menuFor = this.menuFor === hid ? null : hid;
              this.update();
            },
          }),
        ),
        cardFace(card, {
          class: `top${isTarget ? ' target' : ''}${this.stackPick === id ? ' picking' : ''}`,
          onclick: () => {
            if (this.stackPick && isTarget) {
              this.stacks.set(this.stackPick, id);
              this.stackPick = null;
            } else {
              this.stackPick = null;
              this.menuFor = this.menuFor === id ? null : id;
            }
            this.update();
          },
        }),
        menu,
      );
    });

    // Only speak up when the play can't be sent; otherwise the staged cards say it all.
    this.staging.replaceChildren(
      ...present(
        h('div', { class: 'staged-row' }, ...groups),
        visible.length > this.maxVisible
          ? h('div', { class: 'staging-note warn' }, `At most ${this.maxVisible} cards can be visible. Hide some under others.`)
          : null,
      ),
    );
  }

  private menuForVisible(id: string, visible: string[]): HTMLElement {
    const hidden = this.hiddenUnder(id);
    const canHide =
      hidden.length === 0 &&
      visible.some((other) => other !== id && this.hiddenUnder(other).length < this.maxHiddenPerVisible);
    const byId = new Map(store.game!.view.hand.map((c) => [c.id, c]));
    return h(
      'div',
      { class: 'menu' },
      canHide
        ? h('button', { onclick: (e: Event) => this.menuAction(e, () => (this.stackPick = id)) }, 'Stack: hide under…')
        : null,
      // The card(s) hidden under this one can be pulled back out from here too.
      ...hidden.map((hid) => {
        const c = byId.get(hid);
        return h(
          'button',
          { onclick: (e: Event) => this.menuAction(e, () => this.stacks.delete(hid)) },
          `Unstack ${c ? `${c.rank}${SUIT_SYMBOL[c.suit]}` : 'hidden card'}`,
        );
      }),
      h('button', { onclick: (e: Event) => this.menuAction(e, () => this.drop(id)) }, 'Take back'),
    );
  }

  private menuForHidden(id: string): HTMLElement {
    return h(
      'div',
      { class: 'menu' },
      h('button', { onclick: (e: Event) => this.menuAction(e, () => this.stacks.delete(id)) }, 'Unstack'),
      h('button', { onclick: (e: Event) => this.menuAction(e, () => this.drop(id)) }, 'Take back'),
    );
  }

  private menuAction(e: Event, fn: () => void): void {
    e.stopPropagation();
    this.menuFor = null;
    fn();
    this.update();
  }

  private renderRanks(): void {
    const locked = store.game!.view.roundRank;
    this.ranks.replaceChildren(
      h('span', { class: 'ranks-label' }, locked ? `This round is ${claim(2, locked).slice(2)}:` : 'You set the rank:'),
      ...RANKS.map((r) =>
        h(
          'button',
          {
            class: `rank-btn${r === this.rank ? ' active' : ''}`,
            disabled: !!locked && r !== locked,
            onclick: () => {
              this.rank = r;
              this.rankTouched = true;
              this.update();
            },
          },
          r,
        ),
      ),
    );
  }

  private renderActions(): void {
    const v = store.game!.view;
    const visible = this.visibleIds.length;
    const canSend = v.canPlay && visible >= 1 && visible <= this.maxVisible && !this.stackPick;
    const latest = v.latest;
    this.actions.replaceChildren(...present(
      h(
        'button',
        { class: 'primary', disabled: !canSend, onclick: () => this.play(), title: 'Enter' },
        visible ? `Play: "${claim(visible, this.rank)}"` : 'Choose cards to play',
      ),
      this.selected.length > 0
        ? h('button', { class: 'quiet', onclick: () => this.clearSelection(), title: 'Delete' }, 'Clear')
        : null,
      v.canPass ? h('button', { onclick: () => socket.emit('turn:pass'), title: 'P' }, 'Pass') : null,
      // While leaning in, Inspect becomes the way back.
      this.scene.inspecting
        ? h('button', { class: 'active', onclick: () => this.toggleInspect(), title: 'I or Esc' }, '◂ Sit back')
        : v.canInspect
          ? h('button', { onclick: () => this.toggleInspect(), title: 'I' }, 'Inspect')
          : null,
      v.canCall && latest
        ? h(
            'button',
            { class: 'danger', onclick: () => socket.emit('turn:callBluff'), title: 'B' },
            `BLUFF! (${this.name(latest.player)}'s ${claim(latest.count, latest.rank)})`,
          )
        : null,
    ));
  }

  /** Rows of up to 8 cards. Each row tucks over the one above, leaving its corners readable. */
  private renderHand(): void {
    const cards = sortHand(store.game!.view.hand);
    const rows: (typeof cards)[] = [];
    for (let i = 0; i < cards.length; i += HAND_ROW) rows.push(cards.slice(i, i + HAND_ROW));
    const scrollTop = this.hand.scrollTop;
    this.hand.replaceChildren(
      ...rows.map((row) =>
        h(
          'div',
          { class: 'hand-row' },
          ...row.map((card) =>
            cardFace(card, {
              class: this.selected.includes(card.id) ? 'selected' : '',
              onclick: () => this.toggle(card.id),
            }),
          ),
        ),
      ),
    );
    this.hand.scrollTop = scrollTop;
  }

  /** Deselects every card, including any stacks set up between them. */
  private clearSelection(): void {
    this.selected = [];
    this.stacks.clear();
    this.stackPick = null;
    this.menuFor = null;
    this.update();
  }

  private play(): void {
    const v = store.game?.view;
    const visible = this.visibleIds.length;
    if (!v?.canPlay || visible < 1 || visible > this.maxVisible || this.stackPick) return;
    socket.emit('turn:play', {
      cardIds: [...this.selected],
      stacks: [...this.stacks].map(([hidden, under]) => ({ hidden, under })),
      rank: this.rank,
    });
  }

  private toggleInspect(): void {
    if (this.scene.inspecting) this.scene.endInspect();
    else if (store.game?.view.canInspect) socket.emit('turn:inspect');
  }

  private tick(): void {
    // The scene can end an inspection by itself (a new play, a call); keep the button in step.
    if (this.scene.inspecting !== this.wasInspecting) {
      this.wasInspecting = this.scene.inspecting;
      this.renderActions();
      this.renderInspectInfo();
    }
    const v = store.game?.view;
    const deadline = store.turnDeadline;
    const show = !!v?.canPlay && deadline !== null;
    this.timer.classList.toggle('hidden', !show);
    if (show) {
      const left = Math.max(0, deadline - Date.now());
      this.timerFill.style.width = `${Math.min(100, (left / this.turnTotal) * 100)}%`;
      this.timerFill.classList.toggle('low', left < 8000);
    }
  }

  // --- Feed -------------------------------------------------------------------

  private onFeed(item: FeedItem): void {
    switch (item.kind) {
      case 'log':
        // Each line fades out on its own; hovering the log brings the recent ones back.
        this.log.append(h('li', {}, item.text));
        while (this.log.children.length > 8) this.log.firstElementChild!.remove();
        return;
      case 'banner':
        this.showBanner(item.text);
        return;
      case 'reveal': {
        // Just the verdict and the cards; the log has the full story. Off-rank cards are outlined,
        // and a "+N" chip marks cards that were stacked out of sight.
        const m = item.msg;
        const hidden = m.cards.length - m.announcedCount;
        this.reveal.replaceChildren(
          h('h3', { class: m.wasBluff ? 'caught' : 'honest' }, m.wasBluff ? 'CAUGHT!' : 'FALSE ALARM'),
          h(
            'div',
            { class: 'reveal-cards' },
            ...m.cards.map((c) => cardFace(c, { class: c.rank === m.announcedRank ? '' : 'off' })),
            hidden > 0 ? h('span', { class: 'stacked-chip', title: `${hidden} card(s) were stacked out of sight` }, `+${hidden}`) : null,
          ),
        );
        // Let the cards flip on the table first, then show the verdict.
        clearTimeout(this.revealTimer);
        this.reveal.classList.remove('show');
        this.revealTimer = window.setTimeout(() => {
          this.reveal.classList.add('show');
          this.revealTimer = window.setTimeout(() => this.reveal.classList.remove('show'), 4500);
        }, 1500);
        return;
      }
      case 'over': {
        const me = store.game?.view.seat;
        this.over.replaceChildren(
          h(
            'div',
            { class: 'panel' },
            h('h2', {}, item.winner === me ? 'You won!' : `${this.name(item.winner)} won`),
            h('p', { class: 'muted' }, 'Their hand is empty.'),
            h('button', { class: 'primary', onclick: () => this.closeResults() }, 'Back to the table'),
          ),
        );
        window.setTimeout(() => this.over.classList.remove('hidden'), 1500);
        return;
      }
      case 'toast':
        return;
    }
  }

  private showBanner(text: string): void {
    this.banner.textContent = text;
    this.banner.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('show'), 2800);
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement) return;
    const v = store.game?.view;
    if (!v) return;
    if (e.key === 'Escape') {
      this.stackPick = null;
      this.menuFor = null;
      this.scene.endInspect();
      this.update();
    } else if (e.key === 'Enter') this.play();
    else if (e.key === 'Delete' || e.key === 'Backspace') this.clearSelection();
    else if (e.key === 'p' && v.canPass) socket.emit('turn:pass');
    else if (e.key === 'b' && v.canCall) socket.emit('turn:callBluff');
    else if (e.key === 'i') this.toggleInspect();
  };
}
