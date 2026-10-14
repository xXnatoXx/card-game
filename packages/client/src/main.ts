import '@fontsource/vt323';
import '@fontsource/chakra-petch/thai-500.css';
import './style.css';
import { sound } from './audio/sound.js';
import { direct } from './director.js';
import { t } from './i18n.js';
import { store, subscribe } from './net.js';
import { onSettings } from './settings.js';
import { Stage } from './scene/stage.js';
import { TableScene } from './scene/table-scene.js';
import { installCardDither } from './ui/dither.js';
import { h, type Screen } from './ui/dom.js';
import { Feed } from './ui/feed.js';
import { fitUiToFrame } from './ui/frame.js';
import { GameScreen } from './ui/game.js';
import { Labels } from './ui/labels.js';
import { LobbyScreen } from './ui/lobby.js';
import { RoomScreen } from './ui/room.js';
import { settingsPanel } from './ui/settings-panel.js';

installCardDither();
fitUiToFrame(document.getElementById('frame')!);
const stage = new Stage(document.getElementById('stage') as HTMLCanvasElement);
const scene = new TableScene(stage);

// The last 8 seconds of your turn: the screen edges pulse red with a racing heartbeat you can hear.
stage.onFrame((_dt, time) => {
  const deadline = store.turnDeadline;
  const left = store.game?.view.canPlay && deadline !== null ? deadline - Date.now() : Infinity;
  const danger = left < 8000 ? 1 - Math.max(0, left) / 8000 : 0;
  stage.effects.setDanger(danger);
  sound.setDanger(danger, time);
});

// Apply the player's settings now and whenever they change.
onSettings((s) => {
  sound.setVolumes(s);
  document.documentElement.lang = s.language;
  document.getElementById('frame')!.classList.toggle('no-crt', !s.crt);
  stage.effects.intensity = s.reducedEffects ? 0.3 : 1;
  scene.mouseLook = s.mouseLook;
});

// Clicks: a soft tap for cards, a click for buttons.
document.addEventListener(
  'click',
  (e) => {
    const target = e.target as Element | null;
    if (target?.closest('.hand .card, .staged .card')) sound.cardTap();
    else if (target?.closest('button')) sound.click();
  },
  true,
);
const feed = new Feed();
const ui = document.getElementById('ui')!;
const labels = new Labels(document.getElementById('labels')!, scene, stage);
direct(scene, feed, (seat, text, tone) => labels.say(seat, text, tone));

const toasts = h('div', { class: 'toasts' });
const offline = h('div', { class: 'offline panel' });
onSettings(() => (offline.textContent = t().connecting));
ui.append(toasts, offline, settingsPanel.el);

function toast(text: string): void {
  const el = h('div', { class: 'toast' }, text);
  toasts.append(el);
  setTimeout(() => el.remove(), 3500);
}

/** After a game ends, the results stay up until the player goes back to the table. */
let resultsOpen = false;
let lastWinner: number | null = null;
/** Whether a game was running at the last update, so a new one can start with a shuffle. */
let wasPlaying = false;

feed.on((item) => {
  if (item.kind === 'toast') toast(item.text);
  if (item.kind === 'over') resultsOpen = true;
});

type Kind = 'lobby' | 'room' | 'game';
let kind: Kind | null = null;
let screen: Screen | null = null;

function route(): void {
  const { room, game } = store;
  if (game && game.view.winner === null) {
    if (lastWinner !== null) scene.reset(); // a new game started at the same table
    resultsOpen = false;
  }
  lastWinner = game?.view.winner ?? null;
  if (!room) resultsOpen = false;
  const playing = !!game && game.view.winner === null;
  if (playing && !wasPlaying) sound.shuffle();
  wasPlaying = playing;
  sound.setTune(playing ? 'table' : 'lobby');

  const inGame = !!room && !!game && (room.status === 'playing' || resultsOpen);
  const next: Kind = !room ? 'lobby' : inGame ? 'game' : 'room';

  if (!room) {
    scene.setSeats([], null);
    labels.render([]);
  } else if (inGame && game) {
    const v = game.view;
    scene.setSeats(game.seats, v.seat);
    scene.setTurn(v.winner === null ? v.turn : null);
    scene.setHandCounts(v.handCounts);
    scene.syncPool(v.poolCount, v.latest);
    labels.render(
      game.seats.map((s, i) =>
        i === v.seat
          ? null
          : { name: s.name, sub: t().cards(v.handCounts[i]!), turn: v.winner === null && i === v.turn, away: !s.connected },
      ),
    );
  } else {
    const me = room.members.findIndex((m) => m.id === store.me.id);
    scene.setSeats(room.members, me < 0 ? null : me);
    scene.setTurn(null);
    scene.setHandCounts([]);
    scene.syncPool(0, null);
    labels.render(
      room.members.map((m, i) =>
        i === me ? null : { name: m.name, sub: m.bot ? t().bot : m.id === room.hostId ? t().host : '', turn: false, away: !m.connected },
      ),
    );
  }

  if (next !== kind) {
    screen?.destroy();
    screen =
      next === 'lobby'
        ? new LobbyScreen()
        : next === 'room'
          ? new RoomScreen()
          : new GameScreen(feed, scene, () => {
              resultsOpen = false;
              route();
            });
    ui.prepend(screen.el);
    kind = next;
  }
  screen!.update();
  offline.classList.toggle('hidden', store.connected);
}

subscribe(route);
route();
