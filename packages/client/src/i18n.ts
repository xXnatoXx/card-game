// Every line of text the game shows, in English and in Thai. Screens read the chosen set with t().

import type { RoomStatus } from '@bluff/protocol';
import type { Rank } from '@bluff/rules';
import { settings, type Language } from './settings.js';

/** The choices on the lobby's language switch, each named in its own language. */
export const LANGUAGES: readonly { code: Language; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'th', label: 'ไทย' },
];

const RANK_WORDS: Record<Rank, string> = {
  A: 'ace', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven',
  '8': 'eight', '9': 'nine', '10': 'ten', J: 'jack', Q: 'queen', K: 'king',
};
const NUMBER_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four'];

/** "ace" for one, "aces" or "sixes" for more. */
function ranks(count: number, rank: Rank): string {
  const word = RANK_WORDS[rank];
  return count === 1 ? word : word.endsWith('x') ? `${word}es` : `${word}s`;
}

const en = {
  you: 'You',
  seat: (n: number) => `Seat ${n}`,
  animal: (animal: string) => (animal === 'polar' ? 'Polar bear' : animal[0]!.toUpperCase() + animal.slice(1)),
  /** "1 ace", "4 aces", "2 sixes". */
  claim: (count: number, rank: Rank) => `${count} ${ranks(count, rank)}`,
  /** What a player says out loud when playing: "Three queens." */
  spoken: (count: number, rank: Rank) => `${NUMBER_WORDS[count] ?? count} ${ranks(count, rank)}.`,
  host: 'host',
  bot: 'bot',
  away: 'away',
  connecting: 'Connecting to the table…',

  // --- Lobby ---
  yourName: 'Your name',
  tables: 'Tables',
  tableName: 'Table name',
  tableOf: (name: string) => `${name}'s table`,
  doubleMode: 'x2 mode',
  doubleHint: 'x2 mode: two decks shuffled together. The second deck is printed in inverted colours.',
  doubleTag: 'Two decks; the second is inverted',
  openTable: 'Open a table',
  noTables: 'No tables yet. Open one, or play against bots.',
  hostedBy: (name: string) => `host ${name}`,
  status: { waiting: 'open', full: 'full', playing: 'in progress', closed: 'closed' } satisfies Record<RoomStatus, string>,
  join: 'Join',

  // --- Waiting at a table ---
  leave: 'Leave',
  atTable: (count: number, max: number) => `${count}/${max} at the table`,
  modeTag: (decks: number) => `x${decks} mode`,
  modeNote: (cards: number) => `${cards} cards: every card twice, the second copy printed inverted.`,
  removeBot: 'Remove bot',
  yourAnimal: 'Your animal',
  takenBy: (name: string) => `Taken by ${name}`,
  addBot: '+ Add bot',
  needPlayers: 'Need 2+ players',
  startGame: 'Start game',
  waitingForHost: (name?: string) => `Waiting for ${name ?? 'the host'} to start…`,

  // --- Name tags over the animals ---
  cards: (count: number) => `${count} cards`,
  awayTag: (sub: string) => `${sub} (away)`,
  seconds: (count: number) => `${count}s`,

  // --- Game HUD ---
  inPool: (count: number) => `card${count === 1 ? '' : 's'} in the pool`,
  poolHint: 'Face-down cards in the pool',
  roundRankHint: "This round's rank",
  leaveTable: 'Leave the table',
  confirmLeave: 'Leave the game? Your turns will be played for you.',
  youWon: 'You won!',
  won: (name: string) => `${name} won`,
  wonStatus: (name: string) => `${name} won.`,
  pickCover: 'Click the card to hide it under. (Esc cancels)',
  yourTurn: 'Your turn: play cards, or pass.',
  yourTurnMustPlay: 'Your turn. You start this round, so you must play.',
  waitingFor: (name: string) => `Waiting for ${name}…`,
  canCall: 'You can inspect or call the last play.',
  hiddenUnder: 'Hidden under this card',
  tooManyVisible: (max: number) => `At most ${max} cards can be visible. Hide some under others.`,
  stackUnder: 'Stack: hide under…',
  unstack: 'Unstack',
  unstackCard: (card?: string) => `Unstack ${card ?? 'hidden card'}`,
  takeBack: 'Take back',
  roundIs: (rank: Rank) => `This round is ${ranks(2, rank)}:`,
  setRank: 'You set the rank:',
  play: (claim: string) => `Play: "${claim}"`,
  chooseCards: 'Choose cards to play',
  clear: 'Clear',
  pass: 'Pass',
  sitBack: '◂ Sit back',
  sitBackKeys: 'I or Esc',
  inspect: 'Inspect',
  callBluff: (name: string, claim: string) => `BLUFF! (${name}'s ${claim})`,
  caught: 'CAUGHT!',
  falseAlarm: 'FALSE ALARM',
  stackedHint: (count: number) => `${count} card(s) were stacked out of sight`,
  handEmpty: 'Their hand is empty.',
  backToTable: 'Back to the table',

  // --- Said above heads, and the log ---
  sayPass: 'Pass.',
  sayLeansIn: '*leans in*',
  sayBluff: 'BLUFF!',
  caughtLines: ['Caught...', 'Tch.', '...Fine.', 'Damn it.'],
  honestLines: ['Told you.', 'Heh.', 'Every word.', 'Your mistake.'],
  winLines: ["That's all of them.", 'Hands empty.', 'Game.'],
  logPassed: (name: string) => `${name} passed`,
  logInspected: (name: string) => `${name} leaned in for a closer look`,
  logReveal: (caller: string, player: string, wasBluff: boolean, loser: string, taken: number) =>
    `${caller} called BLUFF on ${player}: ${wasBluff ? 'caught' : 'false alarm'}. ${loser} took ${taken}.`,
  roundOver: (count: number) => `Round over. ${count} card${count === 1 ? '' : 's'} left the game.`,
  logStarts: (name: string, isYou: boolean) => `${name} start${isYou ? '' : 's'}.`,
  logWon: (name: string) => `${name} emptied their hand and won!`,
  /** The server words its refusals in English. */
  error: (reason: string) => reason,

  // --- Settings ---
  settings: 'Settings',
  close: 'Close (Esc)',
  sound: 'Sound',
  master: 'Master',
  effects: 'Effects',
  ambience: 'Ambience',
  music: 'Music',
  muteAll: 'Mute everything',
  screen: 'Screen',
  crt: 'CRT scanlines',
  reducedEffects: 'Reduced screen effects',
  reducedEffectsHint: 'Less shake, flashing, glitching and lamp strobing.',
  mouseLook: 'Look around with the mouse',
  savedHere: 'Saved in this browser.',
};

type Strings = typeof en;

const TH_RANKS: Record<Rank, string> = {
  A: 'เอซ', '2': 'สอง', '3': 'สาม', '4': 'สี่', '5': 'ห้า', '6': 'หก', '7': 'เจ็ด',
  '8': 'แปด', '9': 'เก้า', '10': 'สิบ', J: 'แจ็ค', Q: 'ควีน', K: 'คิง',
};
const TH_NUMBERS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด'];

const TH_ANIMALS: Record<string, string> = {
  beaver: 'บีเวอร์', bee: 'ผึ้ง', bunny: 'กระต่าย', cat: 'แมว', caterpillar: 'หนอนผีเสื้อ', chick: 'ลูกเจี๊ยบ',
  cow: 'วัว', crab: 'ปู', deer: 'กวาง', dog: 'หมา', elephant: 'ช้าง', fish: 'ปลา',
  fox: 'จิ้งจอก', giraffe: 'ยีราฟ', hog: 'หมูป่า', koala: 'โคอาลา', lion: 'สิงโต', monkey: 'ลิง',
  panda: 'แพนด้า', parrot: 'นกแก้ว', penguin: 'เพนกวิน', pig: 'หมู', polar: 'หมีขั้วโลก', tiger: 'เสือ',
};

// The server's refusals, matched by their English text. One it doesn't know is shown as it came.
const TH_ERRORS: Record<string, string> = {
  'Bad handshake.': 'เชื่อมต่อไม่สำเร็จ',
  'You opened the game somewhere else.': 'คุณเปิดเกมไว้ที่อื่นแล้ว',
  'Something went wrong on the server.': 'เซิร์ฟเวอร์มีปัญหาบางอย่าง',
  'You are not in a room.': 'คุณไม่ได้อยู่ที่โต๊ะไหน',
  'You are not in this room.': 'คุณไม่ได้อยู่ที่โต๊ะนี้',
  'Leave your current room first.': 'ออกจากโต๊ะที่นั่งอยู่ก่อน',
  'That room no longer exists.': 'โต๊ะนั้นไม่อยู่แล้ว',
  'That room is full or already playing.': 'โต๊ะนั้นเต็มหรือเริ่มเล่นไปแล้ว',
  'The room is full or already playing.': 'โต๊ะเต็มหรือเริ่มเล่นไปแล้ว',
  'Unknown animal.': 'ไม่มีสัตว์ตัวนี้',
  'You cannot change animals during a game.': 'เปลี่ยนสัตว์ระหว่างเกมไม่ได้',
  'Someone else already has that animal.': 'มีคนเลือกสัตว์ตัวนั้นไปแล้ว',
  'Only the host can add bots.': 'โฮสต์เท่านั้นที่เพิ่มบอทได้',
  'Only the host can remove bots.': 'โฮสต์เท่านั้นที่เอาบอทออกได้',
  'You cannot remove bots during a game.': 'เอาบอทออกระหว่างเกมไม่ได้',
  'There is no such bot.': 'ไม่มีบอทตัวนั้น',
  'Only the host can start the game.': 'โฮสต์เท่านั้นที่เริ่มเกมได้',
  'The game has already started.': 'เกมเริ่มไปแล้ว',
  'You need at least 2 players.': 'ต้องมีผู้เล่นอย่างน้อย 2 คน',
  'You are not playing in a game.': 'คุณไม่ได้อยู่ในเกม',
  'No game is running.': 'ไม่มีเกมที่กำลังเล่นอยู่',
  'Bad play.': 'ลงไพ่แบบนี้ไม่ได้',
  'That play could not be read.': 'อ่านไพ่ที่ลงไม่ได้',
  'The game is over.': 'เกมจบแล้ว',
  'It is not your turn.': 'ยังไม่ถึงตาคุณ',
  'Choose at least one card to play.': 'เลือกไพ่อย่างน้อยหนึ่งใบ',
  'The same card was chosen twice.': 'เลือกไพ่ใบเดียวกันซ้ำ',
  'You start this round, so you must play cards.': 'คุณเริ่มรอบนี้ จึงต้องลงไพ่',
  'Only cards in this play can be stacked.': 'ซ้อนได้เฉพาะไพ่ที่ลงในตานี้',
  'A card cannot be stacked under itself.': 'ซ่อนไพ่ไว้ใต้ตัวเองไม่ได้',
  'A card can only be hidden once.': 'ไพ่หนึ่งใบซ่อนได้ครั้งเดียว',
  'Cards can only be hidden under a visible card.': 'ซ่อนไพ่ได้เฉพาะใต้ไพ่ที่มองเห็น',
  'There is no play to inspect or call.': 'ยังไม่มีไพ่ให้ส่องดูหรือจับโกหก',
  'You cannot inspect or call your own play.': 'ส่องดูหรือจับโกหกไพ่ของตัวเองไม่ได้',
};
const TH_ERROR_PATTERNS: readonly [RegExp, string][] = [
  [/^Names are 1 to (\d+) characters\.$/, 'ชื่อต้องยาว 1 ถึง $1 ตัวอักษร'],
  [/^Room names are 1 to (\d+) characters\.$/, 'ชื่อโต๊ะต้องยาว 1 ถึง $1 ตัวอักษร'],
  [/^This round is (\w+)s: every play must be announced as \1\.$/, 'รอบนี้เป็น $1: ทุกคนต้องประกาศว่าเป็น $1'],
  [/^At most (\d+) cards can be visible in one play\.$/, 'ลงให้เห็นได้ไม่เกิน $1 ใบต่อครั้ง'],
  [/^At most (\d+) card\(s\) can be hidden under each visible card\.$/, 'ซ่อนได้ไม่เกิน $1 ใบใต้ไพ่แต่ละใบที่มองเห็น'],
];

const th: Strings = {
  you: 'คุณ',
  seat: (n) => `ที่นั่ง ${n}`,
  animal: (animal) => TH_ANIMALS[animal] ?? animal,
  /** "ควีน 3 ใบ": the rank, then how many cards. */
  claim: (count, rank) => `${TH_RANKS[rank]} ${count} ใบ`,
  spoken: (count, rank) => `${TH_RANKS[rank]} ${TH_NUMBERS[count] ?? count}ใบ`,
  host: 'โฮสต์',
  bot: 'บอท',
  away: 'ไม่อยู่',
  connecting: 'กำลังเชื่อมต่อกับโต๊ะ…',

  yourName: 'ชื่อของคุณ',
  tables: 'โต๊ะ',
  tableName: 'ชื่อโต๊ะ',
  tableOf: (name) => `โต๊ะ ${name}`,
  doubleMode: 'โหมด x2',
  doubleHint: 'โหมด x2: สับไพ่สองสำรับรวมกัน สำรับที่สองพิมพ์สีกลับ',
  doubleTag: 'ไพ่สองสำรับ สำรับที่สองเป็นสีกลับ',
  openTable: 'เปิดโต๊ะ',
  noTables: 'ยังไม่มีโต๊ะ เปิดโต๊ะเอง หรือจะเล่นกับบอทก็ได้',
  hostedBy: (name) => `โฮสต์ ${name}`,
  status: { waiting: 'ว่าง', full: 'เต็ม', playing: 'กำลังเล่น', closed: 'ปิดแล้ว' },
  join: 'เข้าร่วม',

  leave: 'ออก',
  atTable: (count, max) => `${count}/${max} คนที่โต๊ะ`,
  modeTag: (decks) => `โหมด x${decks}`,
  modeNote: (cards) => `ไพ่ ${cards} ใบ: ทุกใบมีสองใบ ใบที่สองพิมพ์สีกลับ`,
  removeBot: 'เอาบอทออก',
  yourAnimal: 'สัตว์ของคุณ',
  takenBy: (name) => `${name} เลือกไปแล้ว`,
  addBot: '+ เพิ่มบอท',
  needPlayers: 'ต้องมีผู้เล่น 2 คนขึ้นไป',
  startGame: 'เริ่มเกม',
  waitingForHost: (name) => `รอ ${name ?? 'โฮสต์'} เริ่มเกม…`,

  cards: (count) => `${count} ใบ`,
  awayTag: (sub) => `${sub} (ไม่อยู่)`,
  seconds: (count) => `${count} วิ`,

  inPool: () => 'ใบในกองกลาง',
  poolHint: 'ไพ่คว่ำในกองกลาง',
  roundRankHint: 'หน้าไพ่ของรอบนี้',
  leaveTable: 'ออกจากโต๊ะ',
  confirmLeave: 'ออกจากเกมไหม? ระบบจะเล่นตาของคุณให้แทน',
  youWon: 'คุณชนะ!',
  won: (name) => `${name} ชนะ`,
  wonStatus: (name) => `${name} ชนะ`,
  pickCover: 'คลิกไพ่ใบที่จะใช้ทับไว้ (Esc ยกเลิก)',
  yourTurn: 'ตาคุณ: ลงไพ่ หรือผ่าน',
  yourTurnMustPlay: 'ตาคุณ คุณเริ่มรอบนี้ จึงต้องลงไพ่',
  waitingFor: (name) => `รอ ${name}…`,
  canCall: 'คุณส่องดูหรือจับโกหกไพ่ที่เพิ่งลงได้',
  hiddenUnder: 'ซ่อนอยู่ใต้ไพ่ใบนี้',
  tooManyVisible: (max) => `วางให้เห็นได้ไม่เกิน ${max} ใบ ซ่อนบางใบไว้ใต้ใบอื่น`,
  stackUnder: 'ซ้อน: ซ่อนไว้ใต้…',
  unstack: 'เลิกซ่อน',
  unstackCard: (card) => `เลิกซ่อน ${card ?? 'ไพ่ที่ซ่อน'}`,
  takeBack: 'เก็บคืน',
  roundIs: (rank) => `รอบนี้เป็น ${TH_RANKS[rank]}:`,
  setRank: 'คุณเลือกหน้าไพ่:',
  play: (claim) => `ลง: "${claim}"`,
  chooseCards: 'เลือกไพ่ที่จะลง',
  clear: 'ล้าง',
  pass: 'ผ่าน',
  sitBack: '◂ ถอยกลับ',
  sitBackKeys: 'I หรือ Esc',
  inspect: 'ส่องดู',
  callBluff: (name, claim) => `โกหก! (${claim} ของ ${name})`,
  caught: 'จับได้!',
  falseAlarm: 'ตื่นตูม!',
  stackedHint: (count) => `มีไพ่ ${count} ใบถูกซ้อนซ่อนไว้`,
  handEmpty: 'ไพ่ในมือหมดแล้ว',
  backToTable: 'กลับไปที่โต๊ะ',

  sayPass: 'ผ่าน',
  sayLeansIn: '*ชะโงกดู*',
  sayBluff: 'โกหก!',
  caughtLines: ['โดนจับได้...', 'ชิ', '...ก็ได้', 'โธ่เว้ย'],
  honestLines: ['บอกแล้วไง', 'หึ', 'จริงทุกคำ', 'พลาดเองนะ'],
  winLines: ['หมดแล้ว', 'มือเปล่าแล้ว', 'จบเกม'],
  logPassed: (name) => `${name} ผ่าน`,
  logInspected: (name) => `${name} ชะโงกเข้าไปดูใกล้ ๆ`,
  logReveal: (caller, player, wasBluff, loser, taken) =>
    `${caller} จับโกหก ${player}: ${wasBluff ? 'จับได้' : 'ตื่นตูม'} ${loser} เก็บไพ่ไป ${taken} ใบ`,
  roundOver: (count) => `จบรอบ ไพ่ ${count} ใบออกจากเกม`,
  logStarts: (name) => `${name} เริ่มรอบต่อไป`,
  logWon: (name) => `${name} ลงไพ่หมดมือและชนะ!`,
  error: (reason) => {
    const known = TH_ERRORS[reason];
    if (known) return known;
    for (const [pattern, text] of TH_ERROR_PATTERNS) if (pattern.test(reason)) return reason.replace(pattern, text);
    return reason;
  },

  settings: 'ตั้งค่า',
  close: 'ปิด (Esc)',
  sound: 'เสียง',
  master: 'เสียงรวม',
  effects: 'เอฟเฟกต์',
  ambience: 'บรรยากาศ',
  music: 'เพลง',
  muteAll: 'ปิดเสียงทั้งหมด',
  screen: 'หน้าจอ',
  crt: 'เส้นสแกนจอ CRT',
  reducedEffects: 'ลดเอฟเฟกต์หน้าจอ',
  reducedEffectsHint: 'ลดการสั่น แสงวาบ ภาพกระตุก และไฟกะพริบ',
  mouseLook: 'ขยับเมาส์เพื่อมองไปรอบ ๆ',
  savedHere: 'บันทึกไว้ในเบราว์เซอร์นี้',
};

const STRINGS: Record<Language, Strings> = { en, th };

/** The text for the language the player chose. */
export function t(): Strings {
  return STRINGS[settings.language];
}
