import { ANIMALS, MAX_ROOM_PLAYERS } from '@bluff/protocol';
import { t } from '../i18n.js';
import { socket, store } from '../net.js';
import { h, present, type Screen } from './dom.js';
import { settingsButton } from './settings-panel.js';

/** Waiting at the table: who's here, pick your animal, add bots, start. */
export class RoomScreen implements Screen {
  readonly el = h('div', { class: 'panel room' });

  update(): void {
    const room = store.room;
    if (!room) return;
    const isHost = room.hostId === store.me.id;
    const me = room.members.find((m) => m.id === store.me.id);
    const taken = new Map(room.members.map((m) => [m.animal, m.name]));
    const host = room.members.find((m) => m.id === room.hostId);
    const s = t();

    this.el.replaceChildren(...present(
      h(
        'div',
        { class: 'room-head' },
        h('h2', {}, room.name),
        h(
          'div',
          { class: 'head-buttons' },
          settingsButton(),
          h('button', { class: 'quiet', onclick: () => socket.emit('room:leave') }, s.leave),
        ),
      ),
      h(
        'p',
        { class: 'muted' },
        s.atTable(room.members.length, MAX_ROOM_PLAYERS),
        room.decks > 1 ? h('span', { class: 'mode-tag' }, s.modeTag(room.decks)) : null,
      ),
      room.decks > 1 ? h('p', { class: 'mode-note' }, s.modeNote(room.decks * 52)) : null,
      h(
        'ul',
        { class: 'members' },
        ...room.members.map((m) =>
          h(
            'li',
            { class: m.id === store.me.id ? 'me' : '' },
            h('span', { class: 'animal-tag' }, s.animal(m.animal)),
            h('span', { class: 'member-name' }, m.name),
            m.id === room.hostId ? h('span', { class: 'badge' }, s.host) : null,
            m.bot ? h('span', { class: 'badge' }, s.bot) : null,
            !m.connected ? h('span', { class: 'badge warn' }, s.away) : null,
            isHost && m.bot
              ? h('button', { class: 'tiny', title: s.removeBot, onclick: () => socket.emit('room:removeBot', { memberId: m.id }) }, '×')
              : null,
          ),
        ),
      ),
      h('h3', {}, s.yourAnimal),
      h(
        'div',
        { class: 'animals' },
        ...ANIMALS.map((a) => {
          const owner = taken.get(a);
          const mine = me?.animal === a;
          return h(
            'button',
            {
              class: `animal${mine ? ' chosen' : ''}`,
              disabled: !!owner && !mine,
              title: owner && !mine ? s.takenBy(owner) : s.animal(a),
              onclick: () => socket.emit('room:setAnimal', { animal: a }),
            },
            s.animal(a),
          );
        }),
      ),
      isHost
        ? h(
            'div',
            { class: 'host-actions' },
            h(
              'button',
              { disabled: room.members.length >= MAX_ROOM_PLAYERS, onclick: () => socket.emit('room:addBot') },
              s.addBot,
            ),
            h(
              'button',
              { class: 'primary', disabled: room.members.length < 2, onclick: () => socket.emit('game:start') },
              room.members.length < 2 ? s.needPlayers : s.startGame,
            ),
          )
        : h('p', { class: 'muted' }, s.waitingForHost(host?.name)),
    ));
  }

  destroy(): void {
    this.el.remove();
  }
}
