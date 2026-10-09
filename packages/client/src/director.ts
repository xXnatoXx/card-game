import type { Rank } from '@bluff/rules';
import { sound } from './audio/sound.js';
import { socket, store } from './net.js';
import type { TableScene } from './scene/table-scene.js';
import { claim } from './ui/dom.js';
import type { Feed } from './ui/feed.js';
import type { Tone } from './ui/labels.js';

/** Types a line above a player's head. */
export type Say = (seat: number, text: string, tone: Tone) => void;

function name(seat: number): string {
  const game = store.game;
  if (game && seat === game.view.seat) return 'You';
  return game?.seats[seat]?.name ?? `Seat ${seat + 1}`;
}

const NUMBER_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four'];

/** What a player says out loud when playing: "Three queens." */
function spoken(count: number, rank: Rank): string {
  const words = claim(count, rank).split(' ').slice(1).join(' ');
  return `${NUMBER_WORDS[count] ?? count} ${words}.`;
}

const pick = (lines: readonly string[]) => lines[Math.floor(Math.random() * lines.length)]!;

const CAUGHT_LINES = ['Caught...', 'Tch.', '...Fine.', 'Damn it.'];
const HONEST_LINES = ['Told you.', 'Heh.', 'Every word.', 'Your mistake.'];
const WIN_LINES = ["That's all of them.", 'Hands empty.', 'Game.'];

/** Turns server events into table animations, lines spoken above heads, and HUD lines. */
export function direct(scene: TableScene, feed: Feed, say: Say): void {
  socket.on('turn:played', (m) => {
    scene.played(m.player, m.count);
    say(m.player, spoken(m.count, m.rank), 'claim');
    feed.emit({ kind: 'log', text: `${name(m.player)}: "${claim(m.count, m.rank)}"` });
  });

  socket.on('turn:passed', (m) => {
    say(m.player, 'Pass.', 'quiet');
    sound.pass();
    feed.emit({ kind: 'log', text: `${name(m.player)} passed` });
  });

  socket.on('turn:inspected', (m) => {
    if (m.by !== store.game?.view.seat) scene.otherInspected(m.by);
    say(m.by, '*leans in*', 'quiet');
    feed.emit({ kind: 'log', text: `${name(m.by)} leaned in for a closer look` });
  });

  socket.on('turn:inspectView', (view) => {
    scene.inspectMine(view.piles);
  });

  socket.on('turn:reveal', (m) => {
    scene.revealed(m);
    say(m.caller, 'BLUFF!', 'call');
    // The called player answers once their cards have flipped.
    setTimeout(() => say(m.player, pick(m.wasBluff ? CAUGHT_LINES : HONEST_LINES), m.wasBluff ? 'quiet' : 'claim'), 1600);
    feed.emit({ kind: 'reveal', msg: m });
    feed.emit({
      kind: 'log',
      text: `${name(m.caller)} called BLUFF on ${name(m.player)}: ${m.wasBluff ? 'caught' : 'false alarm'}. ${name(m.loser)} took ${m.cardsTaken}.`,
    });
  });

  socket.on('round:end', (m) => {
    scene.roundEnded();
    const text = `Round over. ${m.visibleCount} card${m.visibleCount === 1 ? '' : 's'} left the game.`;
    feed.emit({ kind: 'banner', text });
    feed.emit({ kind: 'log', text: `${text} ${name(m.nextStarter)} start${m.nextStarter === store.game?.view.seat ? '' : 's'}.` });
  });

  socket.on('game:over', (m) => {
    scene.gameOver(m.winner);
    say(m.winner, pick(WIN_LINES), 'claim');
    feed.emit({ kind: 'over', winner: m.winner });
    feed.emit({ kind: 'log', text: `${name(m.winner)} emptied their hand and won!` });
  });

  socket.on('error', ({ reason }) => feed.emit({ kind: 'toast', text: reason }));
}
