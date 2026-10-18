import qrcode from 'qrcode-generator';
import { analyze, type Side } from '../engine/game';
import { getTransport, ONLINE_CONFIGURED, releaseTransport, retainTransport, useLocalTransport } from '../online';
import { normalizeCode, randomCode, ROOM_TTL, type RoomData, type SeatId, type Transport } from '../online/types';
import { confirmDialog } from './dialog';
import { h, icon } from './dom';
import { announce, buzz, confetti, sfx, toast } from './fx';
import { nav, type Screen } from './router';
import { GameShell } from './shell';
import { colorHex, PALETTE, sanitizeName, settings, storage } from './store';
import { RoomChat } from './chat';
import { allowanceFor, describeTimer, fmtClock, MAX_STRIKES, randomLegalColumn, SUDDEN_DEATH_MS, timerPicker } from './timer';

const SESSION_KEY = 'online';
export const lastRoom = () => storage.raw<{ code: string }>(SESSION_KEY);
const HISTORY_KEY = 'onlineHistory';
const roomHistory = () => storage.raw<string[]>(HISTORY_KEY) ?? [];
const rememberRoom = (code: string) => {
  storage.set(SESSION_KEY, { code });
  storage.set(HISTORY_KEY, [code, ...roomHistory().filter((c) => c !== code)].slice(0, 8));
};
const forgetRoom = () => storage.remove(SESSION_KEY);

const other = (s: SeatId): SeatId => (s === 'p1' ? 'p2' : 'p1');
/** Parses a move string, keeping only the longest legal prefix (corrupt data can't crash us). */
const movesOf = (s: string): number[] => {
  const out: number[] = [];
  const heights = [0, 0, 0, 0, 0, 0, 0];
  for (const ch of s) {
    const c = ch.charCodeAt(0) - 48;
    if (c < 0 || c > 6 || heights[c] >= 6) break;
    heights[c]++;
    out.push(c);
  }
  return out;
};
const safe = (s: string | null | undefined) => movesOf(s ?? '').join('');
export const roomLink = (code: string) => `${location.origin}/r/${code}${useLocalTransport() ? '?transport=local' : ''}`;

function friendlyError(e: unknown): string {
  const m = String((e as Error)?.message ?? e);
  if (m === 'not-configured') return "Online play isn't configured on this copy of the app yet.";
  if (!navigator.onLine) return "You're offline. Connect to the internet to play online.";
  if (/PERMISSION|permission/.test(m)) return 'That action was refused. The room may have changed — try again.';
  if (/max.*connections|too many|quota/i.test(m)) return 'Online play is busy right now — try again shortly.';
  return 'Could not reach the game server. Check your connection and try again.';
}

/* ------------------------------------------------------------------ */
/* Entry: create or join                                              */
/* ------------------------------------------------------------------ */

export function onlineEntryScreen(prefill = ''): Screen {
  const s = settings.get();
  const nameInput = h('input', {
    class: 'input',
    id: 'online-name',
    maxlength: '16',
    autocomplete: 'nickname',
    placeholder: 'Your name',
    value: s.onlineName || '',
  }) as HTMLInputElement;
  const codeInput = h('input', {
    class: 'input code-input',
    id: 'join-code',
    maxlength: '6',
    inputmode: 'text',
    autocapitalize: 'characters',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'CODE',
    'aria-label': 'Room code',
    value: normalizeCode(prefill),
    oninput: () => {
      const v = normalizeCode(codeInput.value);
      if (v !== codeInput.value) codeInput.value = v;
      joinBtn.disabled = v.length !== 4 || working;
    },
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !joinBtn.disabled) void join();
    },
  }) as HTMLInputElement;
  const picker = timerPicker(settings.get().timerOnline);
  const msg = h('p', { class: 'form-msg', role: 'alert' });
  let working = false;
  let retained = false;
  const transport = () => {
    if (!retained) {
      retained = true;
      retainTransport();
    }
    return getTransport();
  };

  const createBtn = h('button', { class: 'btn primary big', onclick: () => void create() }, 'Create game');
  const joinBtn = h('button', { class: 'btn primary join-btn', onclick: () => void join(), disabled: normalizeCode(prefill).length !== 4 }, 'Join');

  const setWorking = (on: boolean, text = '') => {
    working = on;
    createBtn.disabled = on;
    joinBtn.disabled = on || normalizeCode(codeInput.value).length !== 4;
    msg.textContent = text;
    msg.dataset.tone = on ? 'muted' : 'bad';
  };

  const myName = () => {
    const n = sanitizeName(nameInput.value, 'Player');
    settings.set({ onlineName: n === 'Player' ? '' : n });
    return n;
  };

  async function create() {
    setWorking(true, 'Creating room…');
    try {
      const t = await transport();
      void t.cleanup(roomHistory());
      const now = Date.now();
      let code = '';
      for (let i = 0; i < 6 && !code; i++) {
        const c = randomCode();
        const timer = picker.get();
        settings.set({ timerOnline: timer });
        const ok = await t.create(c, {
          ...(timer ? { timer, bank: { p1: timer.ms, p2: timer.ms } } : {}),
          createdAt: now,
          expiresAt: now + ROOM_TTL,
          status: 'waiting',
          players: { p1: { uid: t.uid, name: myName(), color: settings.get().color1, ...(settings.get().avatar1 ? { avatar: settings.get().avatar1 } : {}) } },
          firstPlayer: Math.random() < 0.5 ? 'p1' : 'p2',
          gameNumber: 1,
          score: { p1: 0, p2: 0, draws: 0 },
        });
        if (ok) code = c;
      }
      if (!code) throw new Error('Could not create room');
      rememberRoom(code);
      nav.replace(() => roomScreen(t, code));
    } catch (e) {
      setWorking(false, friendlyError(e));
    }
  }

  async function join() {
    const code = normalizeCode(codeInput.value);
    if (code.length !== 4) return;
    setWorking(true, 'Joining…');
    try {
      const t = await transport();
      const err = await joinRoom(t, code, myName());
      if (err) return setWorking(false, err);
      rememberRoom(code);
      nav.replace(() => roomScreen(t, code));
    } catch (e) {
      setWorking(false, friendlyError(e));
    }
  }

  const offlineNote =
    !ONLINE_CONFIGURED && !useLocalTransport()
      ? h('p', { class: 'note warn' }, "Online play isn't configured yet. Add your Firebase settings (see README) to enable it.")
      : !navigator.onLine
        ? h('p', { class: 'note warn' }, "You're offline. Pass & Play and vs AI still work.")
        : null;

  const el = h(
    'section',
    { class: 'screen form-screen' },
    h('header', { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => nav.back() }, icon('back')),
      h('h1', { class: 'topbar-title', tabindex: '-1' }, 'Play a friend online'),
      h('span', { class: 'icon-btn-spacer' }),
    ),
    h('div', { class: 'form' },
      offlineNote,
      h('label', { class: 'label', for: 'online-name' }, 'Your name (shown to your friend)'),
      nameInput,
      h('div', { class: 'card' },
        h('h2', null, 'Invite a friend'),
        h('details', { class: 'timer-details' }, h('summary', null, '⏱ Timer (optional)'), picker.el),
        h('p', { class: 'muted' }, "You'll get a link and a 4-character code to send them."),
        createBtn,
      ),
      h('div', { class: 'or' }, h('span', null, 'or')),
      h('div', { class: 'card' },
        h('h2', null, 'Got a code?'),
        h('p', { class: 'muted' }, 'Type the 4-character code your friend sent you.'),
        h('div', { class: 'row join-row' }, codeInput, joinBtn),
      ),
      msg,
    ),
  );

  // Deep-link with a known name joins straight away.
  if (normalizeCode(prefill).length === 4 && s.onlineName) queueMicrotask(() => void join());
  else if (normalizeCode(prefill).length === 4) queueMicrotask(() => nameInput.focus());

  return {
    el,
    destroy() {
      if (retained) releaseTransport();
    },
  };
}

/** Joins (or rejoins) a room. Returns an error message, or null on success. */
async function joinRoom(t: Transport, code: string, name: string): Promise<string | null> {
  let room: RoomData | null;
  try {
    room = await t.get(code);
  } catch (e) {
    // Rooms are private to their two players once full.
    if (/permission/i.test(String((e as Error)?.message ?? e))) return 'That room is already full.';
    throw e;
  }
  if (!room) return `No room found with code ${code}. Check the code and try again.`;
  if (room.expiresAt < Date.now()) return 'That room has expired. Ask your friend to create a new one.';
  if (room.players.p1.uid === t.uid) {
    if (room.left?.p1) await t.update(code, { 'left/p1': null });
    return null; // our own room
  }
  if (room.players.p2?.uid === t.uid) {
    if (room.left?.p2) await t.update(code, { 'left/p2': null });
    if (room.status !== 'playing') await t.update(code, { status: 'playing', expiresAt: Date.now() + ROOM_TTL });
    return null;
  }
  if (room.players.p2) return 'That room is already full.';
  if (room.left?.p1) return 'That room was closed by its creator.';
  let color = settings.get().color1;
  if (color === room.players.p1.color) color = PALETTE.find((p) => p.id !== room.players.p1.color && p.id !== color)!.id;
  if (color === room.players.p1.color) color = settings.get().color2;
  const avatar = settings.get().avatar1;
  const ok = await t.claimP2(code, { uid: t.uid, name, color, ...(avatar ? { avatar } : {}) });
  if (!ok) return 'Someone else just joined that room.';
  await t.update(code, { status: 'playing', expiresAt: Date.now() + ROOM_TTL });
  return null;
}

/** Re-enters a remembered room from the home screen. */
let rejoining = false;
export async function rejoinLast(): Promise<void> {
  const last = lastRoom();
  if (!last || rejoining) return;
  rejoining = true;
  const startDepth = nav.depth();
  retainTransport();
  try {
    const t = await getTransport();
    const err = await joinRoom(t, last.code, settings.get().onlineName || 'Player');
    if (err) {
      forgetRoom();
      toast(err);
      return;
    }
    // Only jump in if the player is still where they were (e.g. didn't start another game meanwhile).
    if (nav.depth() === startDepth) nav.go(() => roomScreen(t, last.code));
  } catch (e) {
    toast(friendlyError(e));
  } finally {
    rejoining = false;
    releaseTransport();
  }
}

/* ------------------------------------------------------------------ */
/* Room: lobby + game                                                 */
/* ------------------------------------------------------------------ */

function roomScreen(t: Transport, code: string): Screen {
  retainTransport();
  const root = h('section', { class: 'screen room' });
  let room: RoomData | null = null;
  let me: SeatId = 'p1';
  let view: 'loading' | 'lobby' | 'game' | 'gone' = 'loading';
  let present: string[] = [];
  let connected = true;
  const offs: (() => void)[] = [];
  let left = false;

  // Game view state
  let shell: GameShell | null = null;
  let shown = ''; // moves currently drawn
  let shownGame = 0;
  let pending: string | null = null; // optimistic moves awaiting server ack
  let animating = false;
  let finishedFor = 0; // gameNumber whose end we've celebrated
  let resetting = false;
  const seenReactions: Record<string, number> = {};
  let rematchBtn: HTMLButtonElement | null = null;
  let claiming = false;
  let startingClock = false;
  const chat = new RoomChat({
    me: () => me,
    nameOf: (s) => room?.players[s]?.name ?? 'Opponent',
    send: (id, msg) => t.update(code, { [`chat/${id}`]: { ...msg, at: t.ts() } }),
    react: (e) => void t.update(code, { [`reactions/${me}`]: { e, at: Date.now() } }).catch(() => undefined),
    seatEl: (s) => shell?.el.querySelector(`.seat[data-seat="${s === 'p1' ? 0 : 1}"]`) ?? null,
  });
  let clockInterval = 0;
  let prevStrikes: Partial<Record<SeatId, number>> = {};

  /** Game result, including losses on time. */
  function outcome(moves: string) {
    const { result } = analyze(movesOf(moves));
    const forfeit = room?.forfeit ?? null;
    if (forfeit && !result.over)
      return { over: true, winner: other(forfeit) as SeatId | null, byTime: true, lines: [] as typeof result.lines };
    return {
      over: result.over,
      winner: result.winner === null ? null : seatOfSide(result.winner),
      byTime: false,
      lines: result.lines,
    };
  }
  const turnSeatOf = (moves: string): SeatId => seatOfSide((moves.length & 1) as Side);
  const allowance = (seat: SeatId) => (room?.timer ? allowanceFor(room.timer, room.bank?.[seat] ?? room.timer.ms) : 0);

  /* ---------- clock ---------- */
  /** Server time by which the player to move must move (null = clock not started). */
  function deadline(): number | null {
    if (!room?.timer || !room.turnAt) return null;
    return room.turnAt + allowance(turnSeatOf(safe(room.moves)));
  }
  let lastClockSecond = -1;
  function tickClock() {
    if (!shell || !room) return;
    const tm = room.timer;
    const serverMoves = safe(room.moves);
    const live = tm && room.players.p2 && room.status === 'playing' && !outcome(serverMoves).over && !room.left?.[other(me)] && !room.left?.[me];
    if (!live) {
      shell.clock.set(null);
      return;
    }
    const turnSeat = turnSeatOf(serverMoves);
    // The clock starts once the player to move is actually looking at the board.
    if (!room.turnAt) {
      shell.clock.set(null);
      if (turnSeat === me && !startingClock && !document.hidden && connected) {
        startingClock = true;
        t.update(code, { turnAt: t.ts() }).catch(() => undefined).finally(() => setTimeout(() => (startingClock = false), 1500));
      }
      return;
    }
    if (pending !== null || animating) return; // a move is in flight / landing
    const left = deadline()! - t.serverNow();
    const sec = shell.clock.set(Math.max(0, left), allowance(turnSeat));
    if (sec >= 0 && sec !== lastClockSecond) {
      lastClockSecond = sec;
      if (turnSeat === me && sec > 0 && sec <= 3) {
        sfx.tick();
        buzz(15);
      }
      if (tm!.kind === 'bank') renderSeats();
    }
    // The player who ran out claims their own timeout quickly; the opponent backs them up.
    if (left < -(turnSeat === me ? 400 : 1500) && !claiming) void claimTimeout(turnSeat);
  }

  async function claimTimeout(seat: SeatId) {
    if (!room?.timer) return;
    claiming = true;
    const tm = room.timer;
    const base = safe(room.moves);
    const strikes = (room.strikes?.[seat] ?? 0) + 1;
    let patch: Record<string, unknown>;
    if (tm.onTimeout === 'lose') patch = { forfeit: seat };
    else if (strikes >= MAX_STRIKES) patch = { forfeit: seat, [`strikes/${seat}`]: strikes };
    else {
      patch = {
        moves: base + String(randomLegalColumn(movesOf(base))),
        [`strikes/${seat}`]: strikes,
        turnAt: t.ts(),
        expiresAt: Date.now() + ROOM_TTL,
        ...(tm.kind === 'bank' ? { [`bank/${seat}`]: 0 } : {}),
      };
    }
    try {
      await t.update(code, patch);
    } catch {
      /* someone else claimed it first, or time hadn't quite run out on the server */
    }
    setTimeout(() => (claiming = false), 1200);
  }

  const leave = async (ask = true) => {
    if (ask && !(await confirmDialog('Leave room?', 'Your opponent will be told you left.', 'Leave', 'Stay'))) return false;
    left = true;
    forgetRoom();
    try {
      await t.update(code, { [`left/${me}`]: true });
    } catch {
      /* best effort */
    }
    return true;
  };

  /* ---------- lobby ---------- */
  function renderLobby() {
    view = 'lobby';
    const link = roomLink(code);
    const qr = qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    const qrEl = h('div', { class: 'qr', role: 'img', 'aria-label': `QR code for joining room ${code}`, html: qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true }) });
    const share = async () => {
      const data = { title: 'Drop Four', text: `Play Drop Four with me! Room code ${code}`, url: link };
      try {
        if (navigator.share) await navigator.share(data);
        else await copy();
      } catch {
        /* user cancelled */
      }
    };
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(link);
        toast('Link copied');
      } catch {
        toast(`Code: ${code}`);
      }
    };
    root.replaceChildren(
      h('header', { class: 'topbar' },
        h('button', { class: 'icon-btn', 'aria-label': 'Leave room', onclick: async () => { if (await leave()) nav.home(); } }, icon('back')),
        h('h1', { class: 'topbar-title', tabindex: '-1' }, 'Invite your friend'),
        h('span', { class: 'icon-btn-spacer' }),
      ),
      h('div', { class: 'lobby' },
        h('p', { class: 'lobby-step' }, h('b', null, '1'), 'Send your friend the link'),
        h('button', { class: 'btn primary big', onclick: share }, icon('share'), 'Send invite link'),
        h('p', { class: 'lobby-step' }, h('b', null, '2'), 'Or let them type this code, or scan it'),
        h('div', { class: 'room-code', 'aria-label': `Room code ${code.split('').join(' ')}` }, ...code.split('').map((ch) => h('span', null, ch))),
        qrEl,
        h('button', { class: 'btn ghost small', onclick: copy }, icon('copy'), 'Copy link'),
        room?.timer ? h('p', { class: 'muted small center' }, `⏱ ${describeTimer(room.timer)}`) : null,
        h('p', { class: 'waiting' }, h('span', { class: 'pulse' }), 'The game starts as soon as they join'),
      ),
    );
  }

  /* ---------- game ---------- */
  const seatIndex = (s: SeatId) => (s === 'p1' ? 0 : 1);
  const seatOfSide = (side: Side): SeatId => (side === 0 ? room!.firstPlayer : other(room!.firstPlayer));
  const colorOfSide = (side: Side) => colorHex(room!.players[seatOfSide(side)]!.color);

  function renderGame() {
    view = 'game';
    shell = new GameShell({
      title: `Room ${code}`,
      onBack: async () => {
        if (await leave()) nav.home();
      },
      board: { color: (s) => colorOfSide(s), onColumn: (c) => void myMove(c) },
    });
    shell.setActions([chat.button]);
    if (room!.timer) shell.setExtra(h('p', { class: 'mood' }, `⏱ ${describeTimer(room!.timer)}`));
    root.replaceChildren(shell.el);
    prevStrikes = { ...(room!.strikes ?? {}) };
    clearInterval(clockInterval);
    clockInterval = window.setInterval(tickClock, 200);
    shown = safe(room!.moves);
    shownGame = room!.gameNumber;
    shell.board.setPosition(movesOf(shown));
    finishedFor = outcome(shown).over ? room!.gameNumber : 0; // don't re-celebrate on reload
    if (finishedFor) showEnd(false);
    sfx.join();
    buzz(20);
  }

  function renderSeats() {
    if (!shell || !room) return;
    // Include the just-finished game, which is only written to the score on rematch.
    const score = { ...{ p1: 0, p2: 0, draws: 0 }, ...room.score };
    const fin = outcome(shown);
    if (fin.over && shownGame === room.gameNumber) {
      if (fin.winner === null) score.draws++;
      else score[fin.winner]++;
    }
    const tm = room.timer;
    const timerSub = (s: SeatId) => {
      if (!tm) return '';
      const parts: string[] = [];
      if (tm.kind === 'bank') {
        const bank = room!.bank?.[s] ?? 0;
        const dl = deadline();
        const live = turnSeatOf(safe(room!.moves)) === s && dl && !fin.over ? Math.min(bank, dl - t.serverNow()) : bank;
        parts.push(bank > 0 ? `⏱ ${fmtClock(Math.max(0, live))}` : `⏱ ${SUDDEN_DEATH_MS / 1000}s/move`);
      }
      const k = room!.strikes?.[s] ?? 0;
      if (k) parts.push(`${k}/${MAX_STRIKES} timeouts`);
      return parts.join(' · ');
    };
    (['p1', 'p2'] as SeatId[]).forEach((s) => {
      const p = room!.players[s];
      if (!p) return;
      shell!.setSeat(seatIndex(s), {
        name: p.name,
        color: colorHex(p.color),
        avatar: p.avatar ?? '',
        score: score[s],
        sub: timerSub(s) || (s === me ? 'You' : room!.left?.[s] ? 'Left' : present.includes(p.uid) ? 'Online' : 'Away'),
        online: s === me ? connected : present.includes(p.uid) && !room!.left?.[s],
      });
    });
    shell.setDraws(score.draws);
  }

  function myTurn() {
    if (!room) return false;
    const m = movesOf(pending ?? shown);
    if (outcome(pending ?? shown).over) return false;
    return seatOfSide((m.length & 1) as Side) === me;
  }

  function refreshTurn() {
    if (!shell || !room) return;
    const m = movesOf(pending ?? shown);
    const opp = room.players[other(me)];
    if (outcome(pending ?? shown).over) {
      shell.board.setInteractive(false);
      shell.setActive(null);
      return;
    }
    const side = (m.length & 1) as Side;
    const turnSeat = seatOfSide(side);
    shell.setActive(seatIndex(turnSeat));
    const oppAway = opp && !present.includes(opp.uid);
    if (room.left?.[other(me)]) {
      shell.setStatus(`${opp?.name ?? 'Opponent'} left the room`, 'bad');
      shell.board.setInteractive(false);
    } else if (!connected) {
      shell.setStatus("You're offline — reconnecting…", 'bad');
      shell.board.setInteractive(false);
    } else if (turnSeat === me) {
      shell.setStatus(oppAway ? 'Your turn · friend is away' : 'Your turn', 'normal', colorHex(room.players[me]!.color));
      shell.board.setInteractive(!animating, side);
    } else {
      shell.setStatus(oppAway ? `${opp?.name} lost connection — waiting` : `${opp?.name}'s turn`, oppAway ? 'bad' : 'thinking', opp ? colorHex(opp.color) : undefined);
      shell.board.setInteractive(false, side);
    }
  }

  async function myMove(c: number) {
    if (!room || animating || pending !== null || !myTurn() || !connected || claiming) return;
    const dl = deadline();
    if (dl !== null && t.serverNow() > dl) return; // out of time: the timeout is being resolved
    const m = movesOf(shown);
    if (!analyze(m).board.canPlay(c)) {
      sfx.invalid();
      shell!.board.shake();
      return;
    }
    const next = shown + String(c);
    pending = next;
    animating = true;
    refreshTurn();
    const patch: Record<string, unknown> = { moves: next, expiresAt: Date.now() + ROOM_TTL };
    if (room.timer) {
      const myBank = room.bank?.[me] ?? 0;
      if (room.timer.kind === 'bank' && myBank > 0 && room.turnAt)
        patch[`bank/${me}`] = Math.max(0, Math.floor(myBank - (t.serverNow() - room.turnAt)));
      patch.turnAt = t.ts();
      shell!.clock.set(null);
    }
    const write = t.update(code, patch);
    await shell!.board.drop(c);
    sfx.drop(6 - analyze(m).board.heights[c]);
    buzz(12);
    animating = false;
    try {
      await write;
      shown = next;
      pending = null;
      announce(`You drop in column ${c + 1}.`);
    } catch (e) {
      pending = null;
      shell!.board.setPosition(movesOf(shown)); // remove the disc the server refused
      toast("Move didn't go through — syncing with the server.");
      void e;
    }
    void sync();
  }

  /** Brings the drawn board in line with server state, animating new opponent moves. */
  async function sync() {
    if (!shell || !room || animating) return;
    if (pending !== null) return refreshTurn();
    const server = safe(room.moves);
    if (room.gameNumber !== shownGame) {
      shownGame = room.gameNumber;
      shown = server;
      shell.hideResult();
      shell.board.setPosition(movesOf(server));
      const first = room.players[room.firstPlayer]!;
      toast(room.firstPlayer === me ? 'New game — you move first' : `New game — ${first.name} moves first`);
      rematchBtn = null;
    } else if (server.startsWith(shown) && server.length > shown.length) {
      animating = true;
      while (shown.length < safe(room.moves).length && safe(room.moves).startsWith(shown)) {
        const c = Number(safe(room.moves)[shown.length]);
        const m = movesOf(shown);
        if (!analyze(m).board.canPlay(c) || analyze(m).result.over) break; // corrupt; fall back below
        await shell.board.drop(c);
        sfx.drop(6 - analyze(m).board.heights[c]);
        buzz(10);
        shown += String(c);
        const who = room.players[seatOfSide(((shown.length - 1) & 1) as Side)];
        announce(`${who?.name ?? 'Opponent'} drops in column ${c + 1}.`);
      }
      animating = false;
      if (!safe(room.moves).startsWith(shown)) {
        shown = safe(room.moves);
        shell.board.setPosition(movesOf(shown));
      }
    } else if (server !== shown) {
      shown = server;
      shell.board.setPosition(movesOf(server));
    }
    renderSeats();
    const res = outcome(shown);
    if (res.over && finishedFor !== room.gameNumber) {
      finishedFor = room.gameNumber;
      showEnd(true);
    } else if (res.over) updateRematchUI();
    refreshTurn();
    void maybeReset();
  }

  function showEnd(celebrate: boolean) {
    if (!shell || !room) return;
    const res = outcome(shown);
    shell.clock.set(null);
    let title = "It's a draw";
    let sub = 'Board full — nobody connected four.';
    let color: string | undefined;
    if (res.winner !== null) {
      if (res.lines.length) shell.board.highlight(res.lines);
      const winner = res.winner;
      const p = room.players[winner]!;
      const loser = room.players[other(winner)];
      color = colorHex(p.color);
      title = winner === me ? (res.byTime ? 'You win on time!' : 'You win!') : res.byTime ? `${p.name} wins on time` : `${p.name} wins`;
      sub = res.byTime
        ? `${other(winner) === me ? 'You' : loser?.name} ran out of time${room.timer?.onTimeout === 'auto' ? ` ${MAX_STRIKES} times` : ''}.`
        : winner === me ? 'Nicely played.' : 'Rematch?';
      if (celebrate) {
        if (winner === me) {
          sfx.win();
          buzz([30, 40, 60]);
          confetti([color, '#ffffff']);
        } else sfx.lose();
      }
    } else if (celebrate) sfx.draw();
    announce(title);
    shell.setStatus(title, 'muted');
    shell.showResult(title, sub, [
      { label: 'Play again', primary: true, onClick: () => void askRematch() },
      { label: 'Leave', onClick: async () => { if (await leave(false)) nav.home(); } },
    ], color);
    rematchBtn = shell.el.querySelector('.result .btn.primary');
    updateRematchUI();
  }

  async function askRematch() {
    try {
      await t.update(code, { [`rematch/${me}`]: true });
    } catch (e) {
      toast(friendlyError(e));
    }
  }

  function updateRematchUI() {
    if (!rematchBtn || !room) return;
    const mine = room.rematch?.[me];
    const theirs = room.rematch?.[other(me)];
    const opp = room.players[other(me)];
    if (room.left?.[other(me)]) {
      rematchBtn.disabled = true;
      rematchBtn.textContent = `${opp?.name ?? 'Opponent'} left`;
    } else if (mine) {
      rematchBtn.disabled = true;
      rematchBtn.textContent = `Waiting for ${opp?.name ?? 'opponent'}…`;
    } else {
      rematchBtn.disabled = false;
      rematchBtn.textContent = theirs ? `${opp?.name ?? 'Opponent'} wants to play again!` : 'Play again';
    }
  }

  /** When both players asked for a rematch, start the next game (first writer wins). */
  async function maybeReset() {
    if (!room || resetting || !room.rematch?.p1 || !room.rematch?.p2) return;
    const res = outcome(safe(room.moves));
    if (!res.over) return;
    resetting = true;
    const score = { ...{ p1: 0, p2: 0, draws: 0 }, ...room.score };
    if (res.winner === null) score.draws++;
    else score[res.winner]++;
    const tm = room.timer;
    const timerReset = tm
      ? { forfeit: null, strikes: null, bank: { p1: tm.ms, p2: tm.ms }, turnAt: null }
      : {};
    try {
      await t.update(code, {
        moves: null,
        gameNumber: room.gameNumber + 1,
        firstPlayer: other(room.firstPlayer),
        score,
        rematch: null,
        expiresAt: Date.now() + ROOM_TTL,
        ...timerReset,
      });
    } catch {
      /* the other player got there first */
    }
    resetting = false;
  }

  function showReactions() {
    if (!room?.reactions || !shell) return;
    (['p1', 'p2'] as SeatId[]).forEach((s) => {
      const r = room!.reactions?.[s];
      if (!r) return;
      if (seenReactions[s] === undefined) {
        seenReactions[s] = r.at; // ignore reactions from before we loaded
        return;
      }
      if (r.at <= seenReactions[s]) return;
      seenReactions[s] = r.at;
      const seat = shell!.el.querySelector(`.seat[data-seat="${seatIndex(s)}"]`);
      if (!seat) return;
      const f = h('span', { class: 'float-emoji', 'aria-hidden': 'true' }, r.e);
      seat.append(f);
      setTimeout(() => f.remove(), 1600);
      if (s !== me) announce(`${room!.players[s]?.name} reacts ${r.e}`);
    });
  }

  function onRoom(r: RoomData | null) {
    if (left) return;
    if (!r) {
      view = 'gone';
      clearInterval(clockInterval);
      shell = null;
      forgetRoom();
      root.replaceChildren(
        h('div', { class: 'gone' },
          h('h1', { tabindex: '-1' }, 'Room closed'),
          h('p', { class: 'muted' }, 'This room no longer exists.'),
          h('button', { class: 'btn primary', onclick: () => nav.home() }, 'Home'),
        ),
      );
      return;
    }
    const prevOppLeft = room?.left?.[other(me)];
    room = r;
    if (r.players.p1.uid === t.uid) me = 'p1';
    else if (r.players.p2?.uid === t.uid) me = 'p2';
    else {
      onRoom(null);
      return;
    }
    if (!r.players.p2) {
      if (view !== 'lobby') renderLobby();
      return;
    }
    if (view !== 'game') renderGame();
    if (!prevOppLeft && r.left?.[other(me)] && view === 'game') {
      toast(`${r.players[other(me)]?.name ?? 'Opponent'} left the room`);
      announce('Your opponent left the room.');
      updateRematchUI();
    }
    showReactions();
    chat.update(r.chat);
    if (r.timer) {
      (['p1', 'p2'] as SeatId[]).forEach((s) => {
        const n = r.strikes?.[s] ?? 0;
        if (n > (prevStrikes[s] ?? 0) && n < MAX_STRIKES) {
          const who = s === me ? 'You' : r.players[s]?.name ?? 'Opponent';
          toast(`Time's up! Random move for ${s === me ? 'you' : who} (${n}/${MAX_STRIKES})`);
          if (s === me) buzz([40, 30, 40]);
        }
      });
      prevStrikes = { ...(r.strikes ?? {}) };
    }
    void sync();
  }

  root.append(h('div', { class: 'loading' }, h('span', { class: 'pulse' }), 'Connecting…'));
  offs.push(t.watch(code, onRoom));
  offs.push(
    t.presence(code, (uids) => {
      const was = present;
      present = uids;
      const opp = room?.players[other(me)];
      if (opp && view === 'game' && was.includes(opp.uid) !== uids.includes(opp.uid)) {
        toast(uids.includes(opp.uid) ? `${opp.name} is back` : `${opp.name} disconnected`);
      }
      renderSeats();
      refreshTurn();
    }),
  );
  offs.push(
    t.connected((on) => {
      connected = on;
      renderSeats();
      refreshTurn();
    }),
  );

  return {
    el: root,
    destroy() {
      clearInterval(clockInterval);
      offs.forEach((f) => f());
      releaseTransport();
    },
    async canLeave() {
      if (left || view === 'gone') return true;
      return leave();
    },
  };
}
