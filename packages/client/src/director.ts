import { sound } from './audio/sound.js';
import { t } from './i18n.js';
import { socket, store } from './net.js';
import type { TableScene } from './scene/table-scene.js';
import type { Feed } from './ui/feed.js';
import type { Tone } from './ui/labels.js';

/** Types a line above a player's head. */
export type Say = (seat: number, text: string, tone: Tone) => void;

function name(seat: number): string {
  const game = store.game;
  if (game && seat === game.view.seat) return t().you;
  return game?.seats[seat]?.name ?? t().seat(seat + 1);
}

const pick = (lines: readonly string[]) => lines[Math.floor(Math.random() * lines.length)]!;

/** Turns server events into table animations, lines spoken above heads, and HUD lines. */
export function direct(scene: TableScene, feed: Feed, say: Say): void {
  socket.on('turn:played', (m) => {
    scene.played(m.player, m.count);
    say(m.player, t().spoken(m.count, m.rank), 'claim');
    feed.emit({ kind: 'log', text: `${name(m.player)}: "${t().claim(m.count, m.rank)}"` });
  });

  socket.on('turn:passed', (m) => {
    say(m.player, t().sayPass, 'quiet');
    sound.pass();
    feed.emit({ kind: 'log', text: t().logPassed(name(m.player)) });
  });

  socket.on('turn:inspected', (m) => {
    if (m.by !== store.game?.view.seat) scene.otherInspected(m.by);
    say(m.by, t().sayLeansIn, 'quiet');
    feed.emit({ kind: 'log', text: t().logInspected(name(m.by)) });
  });

  socket.on('turn:inspectView', (view) => {
    scene.inspectMine(view.piles);
  });

  socket.on('turn:reveal', (m) => {
    scene.revealed(m);
    say(m.caller, t().sayBluff, 'call');
    // The called player answers once their cards have flipped.
    setTimeout(() => say(m.player, pick(m.wasBluff ? t().caughtLines : t().honestLines), m.wasBluff ? 'quiet' : 'claim'), 1600);
    feed.emit({ kind: 'reveal', msg: m });
    feed.emit({
      kind: 'log',
      text: t().logReveal(name(m.caller), name(m.player), m.wasBluff, name(m.loser), m.cardsTaken),
    });
  });

  socket.on('round:end', (m) => {
    scene.roundEnded();
    const text = t().roundOver(m.visibleCount);
    feed.emit({ kind: 'banner', text });
    feed.emit({ kind: 'log', text: `${text} ${t().logStarts(name(m.nextStarter), m.nextStarter === store.game?.view.seat)}` });
  });

  socket.on('game:over', (m) => {
    scene.gameOver(m.winner);
    say(m.winner, pick(t().winLines), 'claim');
    feed.emit({ kind: 'over', winner: m.winner });
    feed.emit({ kind: 'log', text: t().logWon(name(m.winner)) });
  });

  socket.on('error', ({ reason }) => feed.emit({ kind: 'toast', text: t().error(reason) }));
}
