import { MAX_NAME_LENGTH, MAX_ROOM_NAME_LENGTH } from '@bluff/protocol';
import { LANGUAGES, t } from '../i18n.js';
import { saveName, socket, store } from '../net.js';
import { settings, updateSettings } from '../settings.js';
import { h, type Screen } from './dom.js';
import { settingsButton } from './settings-panel.js';

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
    this.roomInput = h('input', { maxLength: MAX_ROOM_NAME_LENGTH });
    this.doubleToggle = h(
      'button',
      {
        type: 'button',
        class: 'mode-toggle',
        onclick: () => {
          this.double = !this.double;
          this.renderToggle();
        },
      },
    );
    this.list = h('div', { class: 'rooms' });
    this.el = h('div', { class: 'panel lobby' });
    this.build();
  }

  /** Lays the panel out in the chosen language. The inputs are kept, so nothing typed is lost. */
  private build(): void {
    const s = t();
    this.roomInput.placeholder = s.tableName;
    this.doubleToggle.title = s.doubleHint;
    this.renderToggle();
    this.el.replaceChildren(
      this.languageSwitch(),
      settingsButton('corner'),
      h('h1', { class: 'title' }, h('span', { class: 'title-false' }, 'FALSE'), ' ', h('span', { class: 'title-alarm' }, 'ALARM')),
      h('label', { class: 'field' }, h('span', {}, s.yourName), this.nameInput),
      h('h2', {}, s.tables),
      this.list,
      h(
        'form',
        {
          class: 'create',
          onsubmit: (e: Event) => {
            e.preventDefault();
            const name = this.roomInput.value.trim() || t().tableOf(store.me.name);
            socket.emit('room:create', { name: name.slice(0, MAX_ROOM_NAME_LENGTH), double: this.double });
          },
        },
        this.roomInput,
        this.doubleToggle,
        h('button', { type: 'submit' }, s.openTable),
      ),
      h('p', { class: 'build' }, import.meta.env.DEV ? `dev · started ${__BUILD_TIME__}` : `build ${__BUILD_TIME__}`),
    );
  }

  /** EN / ไทย in the panel's top-left corner. */
  private languageSwitch(): HTMLElement {
    return h(
      'div',
      { class: 'lang corner' },
      ...LANGUAGES.map(({ code, label }) =>
        h(
          'button',
          {
            type: 'button',
            class: code === settings.language ? 'on' : '',
            'aria-pressed': String(code === settings.language),
            onclick: () => {
              updateSettings({ language: code });
              this.build();
              this.update();
            },
          },
          label,
        ),
      ),
    );
  }

  private renderToggle(): void {
    this.doubleToggle.classList.toggle('on', this.double);
    this.doubleToggle.setAttribute('aria-pressed', String(this.double));
    this.doubleToggle.textContent = `${this.double ? '■' : '□'} ${t().doubleMode}`;
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
    const s = t();
    this.list.replaceChildren(
      ...(rooms.length === 0
        ? [h('p', { class: 'empty' }, s.noTables)]
        : rooms.map((r) =>
            h(
              'div',
              { class: `room-row ${r.status}` },
              h(
                'span',
                { class: 'room-name' },
                r.name,
                r.decks > 1 ? h('span', { class: 'mode-tag', title: s.doubleTag }, `x${r.decks}`) : null,
              ),
              h('span', { class: 'room-host' }, s.hostedBy(r.host)),
              h('span', { class: 'room-count' }, `${r.players}/${r.maxPlayers}`),
              h('span', { class: 'room-status' }, s.status[r.status]),
              h(
                'button',
                { disabled: r.status !== 'waiting', onclick: () => socket.emit('room:join', { roomId: r.id }) },
                s.join,
              ),
            ),
          )),
    );
  }

  destroy(): void {
    this.el.remove();
  }
}
