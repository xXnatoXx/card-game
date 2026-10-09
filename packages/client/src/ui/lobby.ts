import { MAX_NAME_LENGTH, MAX_ROOM_NAME_LENGTH } from '@bluff/protocol';
import { saveName, socket, store } from '../net.js';
import { h, type Screen } from './dom.js';
import { settingsButton } from './settings-panel.js';

const STATUS_TEXT = { waiting: 'open', full: 'full', playing: 'in progress', closed: 'closed' } as const;

export class LobbyScreen implements Screen {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly roomInput: HTMLInputElement;
  private readonly doubleToggle: HTMLButtonElement;
  /** x2 mode for the next table you open: two decks, the second in inverted colours. */
  private double = false;

  constructor() {
    this.nameInput = h('input', {
      value: store.me.name,
      maxLength: MAX_NAME_LENGTH,
      onchange: () => this.rename(),
      onkeydown: (e: KeyboardEvent) => e.key === 'Enter' && this.nameInput.blur(),
    });
    this.roomInput = h('input', { placeholder: 'Table name', maxLength: MAX_ROOM_NAME_LENGTH });
    this.doubleToggle = h(
      'button',
      {
        type: 'button',
        class: 'mode-toggle',
        title: 'x2 mode: two decks shuffled together. The second deck is printed in inverted colours.',
        onclick: () => {
          this.double = !this.double;
          this.renderToggle();
        },
      },
    );
    this.renderToggle();
    this.list = h('div', { class: 'rooms' });

    this.el = h(
      'div',
      { class: 'panel lobby' },
      settingsButton('corner'),
      h('h1', { class: 'title' }, h('span', { class: 'title-false' }, 'FALSE'), ' ', h('span', { class: 'title-alarm' }, 'ALARM')),
      h('p', { class: 'tagline' }, 'Lie well. Look closely. Call it.'),
      h('label', { class: 'field' }, h('span', {}, 'Your name'), this.nameInput),
      h('h2', {}, 'Tables'),
      this.list,
      h(
        'form',
        {
          class: 'create',
          onsubmit: (e: Event) => {
            e.preventDefault();
            const name = this.roomInput.value.trim() || `${store.me.name}'s table`;
            socket.emit('room:create', { name: name.slice(0, MAX_ROOM_NAME_LENGTH), double: this.double });
          },
        },
        this.roomInput,
        this.doubleToggle,
        h('button', { type: 'submit' }, 'Open a table'),
      ),
      h('p', { class: 'build' }, import.meta.env.DEV ? `dev · started ${__BUILD_TIME__}` : `build ${__BUILD_TIME__}`),
    );
  }

  private renderToggle(): void {
    this.doubleToggle.classList.toggle('on', this.double);
    this.doubleToggle.setAttribute('aria-pressed', String(this.double));
    this.doubleToggle.textContent = this.double ? '■ x2 mode' : '□ x2 mode';
  }

  private rename(): void {
    const name = this.nameInput.value.trim().slice(0, MAX_NAME_LENGTH);
    if (!name) {
      this.nameInput.value = store.me.name;
      return;
    }
    saveName(name);
    socket.emit('profile:setName', { name });
  }

  update(): void {
    if (document.activeElement !== this.nameInput) this.nameInput.value = store.me.name;
    const rooms = store.rooms;
    this.list.replaceChildren(
      ...(rooms.length === 0
        ? [h('p', { class: 'empty' }, 'No tables yet. Open one, or play against bots.')]
        : rooms.map((r) =>
            h(
              'div',
              { class: `room-row ${r.status}` },
              h(
                'span',
                { class: 'room-name' },
                r.name,
                r.decks > 1 ? h('span', { class: 'mode-tag', title: 'Two decks; the second is inverted' }, `x${r.decks}`) : null,
              ),
              h('span', { class: 'room-host' }, `host ${r.host}`),
              h('span', { class: 'room-count' }, `${r.players}/${r.maxPlayers}`),
              h('span', { class: 'room-status' }, STATUS_TEXT[r.status]),
              h(
                'button',
                { disabled: r.status !== 'waiting', onclick: () => socket.emit('room:join', { roomId: r.id }) },
                'Join',
              ),
            ),
          )),
    );
  }

  destroy(): void {
    this.el.remove();
  }
}
