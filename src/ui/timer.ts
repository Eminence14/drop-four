import { analyze } from '../engine/game';
import { h } from './dom';

/**
 * Timed matches.
 * - 'move': every turn gets the same time (e.g. 10 s), reset after each move.
 * - 'bank': chess-style total time per player for the whole game. Once a bank
 *   runs out, that player gets SUDDEN_DEATH_MS per move.
 * onTimeout: 'auto' drops a random disc and counts a strike (3 strikes = loss);
 *            'lose' ends the game immediately.
 */
export type TimerKind = 'move' | 'bank';
export type OnTimeout = 'auto' | 'lose';
export interface TimerSpec {
  kind: TimerKind;
  ms: number;
  onTimeout: OnTimeout;
}

export const SUDDEN_DEATH_MS = 5000;
export const MAX_STRIKES = 3;
const MOVE_OPTIONS = [5, 10, 20, 30].map((s) => s * 1000);
const BANK_OPTIONS = [1, 3, 5].map((m) => m * 60_000);

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s}`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function describeTimer(t: TimerSpec | null | undefined): string {
  if (!t) return 'No timer';
  const time = t.kind === 'move' ? `${t.ms / 1000}s per move` : `${t.ms / 60_000} min each`;
  return `${time} · ${t.onTimeout === 'lose' ? 'lose on timeout' : `random move on timeout (${MAX_STRIKES} = loss)`}`;
}

/** How long the player about to move gets for this turn. */
export function allowanceFor(t: TimerSpec, bankLeft: number): number {
  if (t.kind === 'move') return t.ms;
  return bankLeft > 0 ? bankLeft : SUDDEN_DEATH_MS;
}

/** A random legal column, gently favouring the centre (the "timeout move"). */
export function randomLegalColumn(moves: readonly number[]): number {
  const { board } = analyze(moves);
  const legal = [0, 1, 2, 3, 4, 5, 6].filter((c) => board.canPlay(c));
  const w = legal.map((c) => 4 - Math.abs(3 - c));
  let x = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < legal.length; i++) if ((x -= w[i]) <= 0) return legal[i];
  return legal[legal.length - 1];
}

/** Picker used before 2-player and online games. */
export function timerPicker(initial: TimerSpec | null): { el: HTMLElement; get: () => TimerSpec | null } {
  let kind: 'off' | TimerKind = initial?.kind ?? 'off';
  let moveMs = initial?.kind === 'move' ? initial.ms : 10_000;
  let bankMs = initial?.kind === 'bank' ? initial.ms : 180_000;
  let onTimeout: OnTimeout = initial?.onTimeout ?? 'auto';
  const el = h('div', { class: 'timer-picker' });

  const seg = <T extends string | number>(label: string, opts: [T, string][], cur: T, set: (v: T) => void) =>
    h('div', { class: 'tp-row' },
      h('span', { class: 'label' }, label),
      h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label },
        ...opts.map(([v, l]) =>
          h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === cur), onclick: () => { set(v); render(); } }, l),
        ),
      ),
    );

  const render = () => {
    const rows: HTMLElement[] = [
      seg<'off' | TimerKind>('Timer', [['off', 'Off'], ['move', 'Per move'], ['bank', 'Total']], kind, (v) => (kind = v)),
    ];
    if (kind === 'move')
      rows.push(seg('Time per move', MOVE_OPTIONS.map((m) => [m, `${m / 1000}s`] as [number, string]), moveMs, (v) => (moveMs = v)));
    if (kind === 'bank')
      rows.push(seg('Time per player', BANK_OPTIONS.map((m) => [m, `${m / 60_000} min`] as [number, string]), bankMs, (v) => (bankMs = v)));
    if (kind !== 'off') {
      rows.push(seg<OnTimeout>('When time runs out', [['auto', 'Random move'], ['lose', 'Lose']], onTimeout, (v) => (onTimeout = v)));
      rows.push(
        h('p', { class: 'muted small tp-help' },
          onTimeout === 'auto'
            ? `A random disc is dropped for you. ${MAX_STRIKES} timeouts in one game and you lose.`
            : 'Run out of time and you lose the game.',
          kind === 'bank' ? ` When your total runs out you get ${SUDDEN_DEATH_MS / 1000}s per move.` : '',
        ),
      );
    }
    el.replaceChildren(...rows);
  };
  render();
  return {
    el,
    get: () => (kind === 'off' ? null : { kind, ms: kind === 'move' ? moveMs : bankMs, onTimeout }),
  };
}

/** Countdown ring shown in the turn banner. */
export class ClockView {
  readonly el: HTMLElement;
  private ring: SVGCircleElement;
  private text: HTMLElement;
  private lastSecond = -1;
  constructor() {
    this.el = h('span', { class: 'clock', hidden: true, role: 'timer', 'aria-live': 'off' });
    this.el.innerHTML =
      '<svg viewBox="0 0 36 36" aria-hidden="true"><circle class="clock-track" cx="18" cy="18" r="15.5"/><circle class="clock-fill" cx="18" cy="18" r="15.5"/></svg><b></b>';
    this.ring = this.el.querySelector('.clock-fill')!;
    this.text = this.el.querySelector('b')!;
  }
  /** remaining/total in ms; returns the whole seconds left (for tick sounds). */
  set(remaining: number | null, total = 1): number {
    if (remaining === null) {
      this.el.hidden = true;
      this.lastSecond = -1;
      return -1;
    }
    this.el.hidden = false;
    const frac = Math.max(0, Math.min(1, remaining / total));
    const C = 2 * Math.PI * 15.5;
    this.ring.style.strokeDasharray = `${C}`;
    this.ring.style.strokeDashoffset = `${C * (1 - frac)}`;
    this.text.textContent = fmtClock(remaining);
    const urgent = remaining <= 3000;
    this.el.classList.toggle('urgent', urgent);
    const sec = Math.ceil(remaining / 1000);
    const changed = sec !== this.lastSecond;
    this.lastSecond = sec;
    return changed ? sec : -1;
  }
}
