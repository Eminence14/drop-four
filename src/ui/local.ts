import { analyze, type Side } from '../engine/game';
import { ai } from '../ai/client';
import { LEVEL_INFO, describeScore, type Level } from '../ai/search';
import { h } from './dom';
import { announce, buzz, confetti, sfx, toast } from './fx';
import { nav, type Screen } from './router';
import { GameShell, actionButton } from './shell';
import { bumpAiRecord, colorHex, colorName, sanitizeName, settings, storage, type ColorId } from './store';
import { promptDialog } from './dialog';
import { allowanceFor, fmtClock, MAX_STRIKES, SUDDEN_DEATH_MS, randomLegalColumn, type TimerSpec } from './timer';

export interface Seat {
  name: string;
  color: ColorId;
  kind: 'human' | 'ai';
  avatar?: string;
}

export interface LocalGameState {
  mode: 'pvp' | 'ai';
  seats: [Seat, Seat];
  /** Seat index that moves first in the current game. */
  firstSeat: 0 | 1;
  moves: number[];
  score: [number, number];
  draws: number;
  level?: Level;
  /** Timed matches (2 Players). */
  timer?: TimerSpec | null;
  bank?: [number, number];
  strikes?: [number, number];
  /** Seat that lost on time, if any. */
  forfeit?: 0 | 1 | null;
  /** Time left on the current turn when the app was hidden/closed (so reloading can't refill it). */
  turnLeft?: number | null;
}

const RESUME_KEY = 'resume';
export const loadResume = () => {
  const s = storage.raw<LocalGameState>(RESUME_KEY);
  if (!s || !Array.isArray(s.moves) || !s.moves.length) return null;
  try {
    if (analyze(s.moves).result.over) return null;
  } catch {
    return null;
  }
  return s;
};
export const clearResume = () => storage.remove(RESUME_KEY);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function localGameScreen(initial: LocalGameState, openSettings: () => void): Screen {
  const st: LocalGameState = structuredClone(initial);
  let busy = false;
  let animating = false;
  let coached = Boolean(storage.raw<boolean>('coached'));
  let token = 0; // invalidates async AI work after undo / leave
  let finished = false;
  const aiSeat = st.seats.findIndex((s) => s.kind === 'ai');
  const isAI = st.mode === 'ai';

  const timer = st.timer ?? null;
  if (timer) {
    st.bank ??= [timer.ms, timer.ms];
    st.strikes ??= [0, 0];
  }
  let clockSeat = -1;
  let deadline = 0;
  let turnTotal = 0;
  let pausedLeft: number | null = null;
  let clockInterval = 0;
  let lastSeatRender = 0;

  const seatOf = (side: Side) => (side === 0 ? st.firstSeat : ((1 - st.firstSeat) as 0 | 1));
  const colorOf = (side: Side) => colorHex(st.seats[seatOf(side)].color);

  const shell = new GameShell({
    title: isAI ? `vs Computer · ${LEVEL_INFO[st.level!].label}` : '2 Players',
    onBack: () => nav.back(),
    onSettings: openSettings,
    board: { color: colorOf, onColumn: (c) => onColumn(c) },
  });

  const unsub = settings.subscribe(() => {
    shell.board.recolor();
    renderSeats();
  });

  const undoBtn = timer ? null : actionButton('Undo', 'undo', () => undo(), { id: 'undo' });
  const hintBtn = isAI ? actionButton('Hint', 'bulb', () => void showHint(), { id: 'hint' }) : null;
  const mood = h('p', { class: 'mood', 'aria-live': 'polite' });
  shell.setActions([undoBtn, hintBtn]);
  if (isAI) shell.setExtra(mood);

  function renderSeats() {
    st.seats.forEach((s, i) =>
      shell.setSeat(i, {
        name: s.name,
        color: colorHex(s.color),
        avatar: s.avatar ?? '',
        score: st.score[i],
        sub: s.kind === 'ai' ? LEVEL_INFO[st.level!].label : timer ? timerSub(i) : i === st.firstSeat ? 'Moves first' : '',
      }),
    );
    shell.setDraws(st.draws);
  }

  function timerSub(i: number): string {
    if (!timer) return '';
    const parts: string[] = [];
    if (timer.kind === 'bank') {
      const left = i === clockSeat ? Math.max(0, pausedLeft ?? deadline - performance.now()) : st.bank![i];
      parts.push(st.bank![i] > 0 ? `⏱ ${fmtClock(Math.min(left, st.bank![i] || left))}` : `⏱ ${SUDDEN_DEATH_MS / 1000}s/move`);
    }
    if (timer.onTimeout === 'auto' && st.strikes![i]) parts.push(`${st.strikes![i]}/${MAX_STRIKES} timeouts`);
    return parts.join(' · ') || (i === st.firstSeat ? 'Moves first' : '');
  }

  /* ---------- clock ---------- */
  function startClock(seatIdx: number) {
    if (!timer || finished) return;
    const full = allowanceFor(timer, st.bank![seatIdx]);
    const allow = st.turnLeft != null ? Math.min(full, Math.max(1000, st.turnLeft)) : full;
    st.turnLeft = null;
    clockSeat = seatIdx;
    turnTotal = full;
    deadline = performance.now() + allow;
    pausedLeft = document.hidden ? allow : null;
    clearInterval(clockInterval);
    clockInterval = window.setInterval(tickClock, 200);
    tickClock();
  }
  function stopClock() {
    if (!timer || clockSeat < 0) return;
    clearInterval(clockInterval);
    const left = pausedLeft ?? deadline - performance.now();
    if (timer.kind === 'bank' && st.bank![clockSeat] > 0) st.bank![clockSeat] = Math.max(0, Math.round(left));
    clockSeat = -1;
    shell.clock.set(null);
  }
  function tickClock() {
    if (clockSeat < 0) return;
    const left = pausedLeft ?? deadline - performance.now();
    const sec = shell.clock.set(Math.max(0, left), turnTotal);
    if (sec > 0 && sec <= 3) {
      sfx.tick();
      buzz(15);
    }
    if (timer!.kind === 'bank' && performance.now() - lastSeatRender > 250) {
      lastSeatRender = performance.now();
      renderSeats();
    }
    if (left <= 0) onTimeout();
  }
  function onTimeout() {
    const seat = clockSeat as 0 | 1;
    stopClock();
    if (timer!.kind === 'bank') st.bank![seat] = 0;
    const name = st.seats[seat].name;
    if (timer!.onTimeout === 'lose') {
      st.forfeit = seat;
      return finish();
    }
    st.strikes![seat]++;
    if (st.strikes![seat] >= MAX_STRIKES) {
      st.forfeit = seat;
      return finish();
    }
    sfx.invalid();
    buzz([40, 30, 40]);
    toast(`Time's up! Random move for ${name} (${st.strikes![seat]}/${MAX_STRIKES})`);
    announce(`Time's up for ${name}. A random disc was dropped.`);
    void doMove(randomLegalColumn(st.moves), true);
  }
  const onVisibility = () => {
    if (clockSeat < 0) return;
    if (document.hidden && pausedLeft === null) {
      pausedLeft = deadline - performance.now();
      st.turnLeft = pausedLeft;
      save();
      st.turnLeft = null;
    }
    else if (!document.hidden && pausedLeft !== null) {
      deadline = performance.now() + pausedLeft;
      pausedLeft = null;
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  function save() {
    storage.set(RESUME_KEY, st);
  }

  function humanCanUndo() {
    if (finished || animating || !st.moves.length) return false;
    if (!isAI) return true;
    // Must have at least one human move on the board.
    const humanSide: Side = st.firstSeat === aiSeat ? 1 : 0;
    return st.moves.length > humanSide;
  }

  function refreshButtons() {
    if (undoBtn) (undoBtn as HTMLButtonElement).disabled = !humanCanUndo() || (busy && !isAI);
    if (hintBtn) {
      const humanTurn = !finished && st.seats[seatOf((st.moves.length & 1) as Side)].kind === 'human';
      (hintBtn as HTMLButtonElement).disabled = busy || !humanTurn;
    }
  }

  function next() {
    const { result } = analyze(st.moves);
    if (result.over || st.forfeit != null) return finish();
    const side = (st.moves.length & 1) as Side;
    const seatIdx = seatOf(side);
    const seat = st.seats[seatIdx];
    shell.setActive(seatIdx);
    if (seat.kind === 'ai') {
      shell.board.setInteractive(false, side);
      shell.setStatus(`${seat.name} is thinking`, 'thinking', colorHex(seat.color));
      refreshButtons();
      void aiTurn();
    } else {
      shell.board.setInteractive(true, side);
      shell.setStatus(isAI ? 'Your turn' : `${seat.name}'s turn`, 'normal', colorHex(seat.color));
      if (!coached) shell.coach('Tap a column to drop your disc');
      busy = false;
      startClock(seatIdx);
      refreshButtons();
    }
  }

  async function aiTurn() {
    const my = ++token;
    busy = true;
    refreshButtons();
    const t0 = performance.now();
    try {
      const res = await ai.move(st.moves, st.level!);
      const minDelay = st.level === 'hard' || st.level === 'advanced' ? 250 : 550;
      const wait = minDelay - (performance.now() - t0);
      if (wait > 0) await sleep(wait);
      if (my !== token) return;
      if (st.level === 'hard' || st.level === 'advanced' || st.level === 'medium') {
        const d = describeScore(res.score, st.moves.length);
        mood.textContent =
          d.startsWith('Winning') ? `Computer: "I see a forced win."` :
          d.startsWith('Losing') ? `Computer: "Hmm… you might have me."` :
          d === 'Clear advantage' ? `Computer: "I like my position."` :
          d === 'Under pressure' ? `Computer: "You're pressing me."` : '';
      }
      await doMove(res.col);
    } catch (e) {
      if ((e as Error).message !== 'cancelled' && my === token) {
        toast('The AI hit a snag — playing a safe move.');
        const legal = [3, 2, 4, 1, 5, 0, 6].find((c) => analyze(st.moves).board.canPlay(c))!;
        await doMove(legal);
      }
    }
  }

  function onColumn(c: number) {
    if (busy || finished) return;
    const { board } = analyze(st.moves);
    if (!board.canPlay(c)) {
      sfx.invalid();
      buzz(30);
      shell.board.shake();
      return;
    }
    void doMove(c);
  }

  async function doMove(c: number, auto = false) {
    if (!auto) stopClock();
    busy = true;
    const side = (st.moves.length & 1) as Side;
    shell.board.setInteractive(false, side);
    refreshButtons();
    const depth = 6 - analyze(st.moves).board.heights[c];
    if (!coached && st.seats[seatOf(side)].kind === 'human') {
      coached = true;
      storage.set('coached', true);
      shell.coach(null);
    }
    // Update the banner straight away so it never lags behind the falling disc.
    const nextSeat = st.seats[seatOf((1 - side) as Side)];
    if (!analyze([...st.moves, c]).result.over)
      shell.setStatus(nextSeat.kind === 'ai' ? `${nextSeat.name} is thinking` : isAI ? 'Your turn' : `${nextSeat.name}'s turn`,
        nextSeat.kind === 'ai' ? 'thinking' : 'normal', colorHex(nextSeat.color));
    shell.setActive(seatOf((1 - side) as Side));
    animating = true;
    await shell.board.drop(c);
    animating = false;
    st.moves.push(c);
    sfx.drop(depth);
    buzz(12);
    announce(`${st.seats[seatOf(side)].name} drops in column ${c + 1}.`);
    save();
    busy = false;
    next();
  }

  function finish() {
    finished = true;
    busy = false;
    stopClock();
    const { result } = analyze(st.moves);
    shell.board.setInteractive(false);
    shell.setActive(null);
    refreshButtons();
    clearResume();
    let title: string;
    let sub = '';
    let color: string | undefined;
    if (st.forfeit != null) {
      const winIdx = (1 - st.forfeit) as 0 | 1;
      st.score[winIdx]++;
      const winner = st.seats[winIdx];
      color = colorHex(winner.color);
      title = `${winner.name} wins on time`;
      sub = timer?.onTimeout === 'auto' ? `${st.seats[st.forfeit].name} ran out of time ${MAX_STRIKES} times.` : `${st.seats[st.forfeit].name} ran out of time.`;
      sfx.win();
      buzz([30, 40, 60]);
      confetti([color, '#ffffff']);
    } else if (result.winner === null) {
      st.draws++;
      title = "It's a draw";
      sub = 'Board full — nobody connected four.';
      sfx.draw();
      if (isAI) bumpAiRecord(st.level!, 'd');
    } else {
      shell.board.highlight(result.lines);
      const seatIdx = seatOf(result.winner);
      st.score[seatIdx]++;
      const seat = st.seats[seatIdx];
      color = colorHex(seat.color);
      if (isAI) {
        const humanWon = seat.kind === 'human';
        bumpAiRecord(st.level!, humanWon ? 'w' : 'l');
        title = humanWon ? 'You win!' : 'Computer wins';
        sub = humanWon ? `You beat ${LEVEL_INFO[st.level!].label}.` : 'Rematch? The AI is ready.';
        if (humanWon) {
          sfx.win();
          buzz([30, 40, 60]);
          confetti([color, '#ffffff', colorHex(st.seats[1 - seatIdx].color)]);
        } else sfx.lose();
      } else {
        title = `${seat.name} wins!`;
        sub = `${colorName(seat.color)} connected four in ${Math.ceil(st.moves.length / 2)} moves.`;
        sfx.win();
        buzz([30, 40, 60]);
        confetti([color, '#ffffff']);
      }
    }
    announce(`${title}. ${sub}`);
    shell.setStatus(title, result.winner === null ? 'muted' : 'good');
    renderSeats();
    shell.showResult(title, sub, [
      { label: 'Play again', primary: true, onClick: rematch },
      { label: 'Home', onClick: () => nav.home() },
    ], color);
  }

  function rematch() {
    token++;
    finished = false;
    st.firstSeat = (1 - st.firstSeat) as 0 | 1;
    st.moves = [];
    if (timer) {
      st.bank = [timer.ms, timer.ms];
      st.strikes = [0, 0];
    }
    st.forfeit = null;
    mood.textContent = '';
    shell.hideResult();
    shell.board.setPosition([]);
    renderSeats();
    const first = st.seats[st.firstSeat];
    toast(isAI ? (first.kind === 'ai' ? 'Computer goes first this time' : 'You go first this time') : `${first.name} goes first`);
    save();
    next();
  }

  function undo() {
    if (!humanCanUndo()) return;
    token++; // cancels pending AI work
    ai.cancel();
    const pops = () => {
      st.moves.pop();
      shell.board.undo();
    };
    if (isAI) {
      // Pop until it's the human's turn again and at least one human move was removed.
      const humanSide: Side = st.firstSeat === aiSeat ? 1 : 0;
      let removedHuman = false;
      while (st.moves.length) {
        const lastSide = ((st.moves.length - 1) & 1) as Side;
        pops();
        if (lastSide === humanSide) removedHuman = true;
        if (removedHuman && (st.moves.length & 1) === humanSide) break;
      }
      mood.textContent = '';
    } else pops();
    sfx.tick();
    busy = false;
    save();
    next();
  }

  async function showHint() {
    const my = token;
    busy = true;
    refreshButtons();
    shell.board.setInteractive(false);
    shell.setStatus('Finding a good move', 'thinking');
    try {
      const r = await ai.hint(st.moves);
      if (my !== token) return;
      shell.board.flashColumn(r.col);
      toast(`Try column ${r.col + 1}`);
      announce(`Hint: try column ${r.col + 1}`);
    } catch {
      /* cancelled */
    }
    busy = false;
    next();
  }

  if (!isAI)
    st.seats.forEach((seat, i) =>
      shell.onSeatTap(i, `Rename ${seat.name}`, async () => {
        const v = await promptDialog('Player name', st.seats[i].name);
        if (v === null) return;
        st.seats[i].name = sanitizeName(v, `Player ${i + 1}`);
        settings.set(i === 0 ? { name1: st.seats[i].name } : { name2: st.seats[i].name });
        renderSeats();
        save();
        // Re-render the banner; with a timer running, don't restart the clock.
        if (!finished && clockSeat < 0 && !animating && !busy) next();
        else if (!finished) shell.setStatus(`${st.seats[clockSeat].name}'s turn`, 'normal', colorHex(st.seats[clockSeat].color));
      }),
    );

  // Boot
  renderSeats();
  shell.board.setPosition(st.moves);
  save();
  next();

  return {
    el: shell.el,
    destroy() {
      token++;
      clearInterval(clockInterval);
      document.removeEventListener('visibilitychange', onVisibility);
      ai.cancel();
      unsub();
    },
  };
}
