import { ANIMALS, MAX_ROOM_PLAYERS } from '@bluff/protocol';
import { socket, store } from '../net.js';
import { animalName, h, present, type Screen } from './dom.js';

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

    this.el.replaceChildren(...present(
      h(
        'div',
        { class: 'room-head' },
        h('h2', {}, room.name),
        h('button', { class: 'quiet', onclick: () => socket.emit('room:leave') }, 'Leave'),
      ),
      h(
        'p',
        { class: 'muted' },
        `${room.members.length}/${MAX_ROOM_PLAYERS} at the table`,
        room.decks > 1 ? h('span', { class: 'mode-tag' }, `x${room.decks} mode`) : null,
      ),
      room.decks > 1 ? h('p', { class: 'mode-note' }, `${room.decks * 52} cards: every card twice, the second copy printed inverted.`) : null,
      h(
        'ul',
        { class: 'members' },
        ...room.members.map((m) =>
          h(
            'li',
            { class: m.id === store.me.id ? 'me' : '' },
            h('span', { class: 'animal-tag' }, animalName(m.animal)),
            h('span', { class: 'member-name' }, m.name),
            m.id === room.hostId ? h('span', { class: 'badge' }, 'host') : null,
            m.bot ? h('span', { class: 'badge' }, 'bot') : null,
            !m.connected ? h('span', { class: 'badge warn' }, 'away') : null,
            isHost && m.bot
              ? h('button', { class: 'tiny', title: 'Remove bot', onclick: () => socket.emit('room:removeBot', { memberId: m.id }) }, '×')
              : null,
          ),
        ),
      ),
      h('h3', {}, 'Your animal'),
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
              title: owner && !mine ? `Taken by ${owner}` : animalName(a),
              onclick: () => socket.emit('room:setAnimal', { animal: a }),
            },
            animalName(a),
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
              '+ Add bot',
            ),
            h(
              'button',
              { class: 'primary', disabled: room.members.length < 2, onclick: () => socket.emit('game:start') },
              room.members.length < 2 ? 'Need 2+ players' : 'Start game',
            ),
          )
        : h('p', { class: 'muted' }, `Waiting for ${host?.name ?? 'the host'} to start…`),
    ));
  }

  destroy(): void {
    this.el.remove();
  }
}
