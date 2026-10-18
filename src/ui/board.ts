import { Board, COLS, ROWS, type Line, type Side } from '../engine/game';
import { h } from './dom';
import { reducedMotion, sfx } from './fx';
import { settings } from './store';

export interface BoardViewOptions {
  color: (side: Side) => string;
  onColumn: (col: number) => void;
}

/**
 * Renders the 7×6 board. Discs live *behind* a masked frame so they appear
 * to fall inside the slots. Purely visual: it never decides legality.
 */
export class BoardView {
  readonly el: HTMLElement;
  private discs: HTMLElement;
  private drain: HTMLElement;
  private winSvg: SVGSVGElement;
  private boardEl!: HTMLElement;
  private ghost: HTMLElement;
  private cols: HTMLButtonElement[] = [];
  private discEls = new Map<number, HTMLElement>(); // cell -> el
  private model = new Board();
  private interactive = false;
  private ghostSide: Side = 0;
  private cursor = 3;
  private hover = -1;
  private keyboardMode = false;

  constructor(private opts: BoardViewOptions) {
    this.discs = h('div', { class: 'discs', 'aria-hidden': 'true' });
    this.drain = h('div', { class: 'discs-drain', 'aria-hidden': 'true' });
    this.winSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.winSvg.setAttribute('class', 'win-line');
    this.winSvg.setAttribute('viewBox', `0 0 ${COLS} ${ROWS}`);
    this.winSvg.setAttribute('aria-hidden', 'true');
    this.ghost = h('div', { class: 'ghost-disc disc', 'aria-hidden': 'true' });
    const colsWrap = h('div', { class: 'cols' });
    for (let c = 0; c < COLS; c++) {
      const b = h('button', {
        class: 'col',
        type: 'button',
        'aria-label': `Column ${c + 1}`,
        tabindex: '-1',
        onclick: () => this.tryColumn(c),
        onpointerenter: (e: PointerEvent) => {
          if (e.pointerType === 'mouse') this.setHover(c);
        },
        onpointerleave: () => this.setHover(-1),
      });
      this.cols.push(b);
      colsWrap.append(b);
    }
    const frame = h('div', { class: 'frame', 'aria-hidden': 'true' });
    const board = h('div', { class: 'board' }, this.discs, this.drain, frame, this.winSvg, colsWrap);
    this.boardEl = board;
    this.el = h(
      'div',
      {
        class: 'board-wrap',
        role: 'group',
        'aria-label': 'Game board. Use left and right arrows to choose a column, Enter to drop, or keys 1 to 7.',
        tabindex: '0',
        onkeydown: (e: KeyboardEvent) => this.onKey(e),
        onfocus: () => {
          this.keyboardMode = true;
          this.renderGhost();
        },
        onblur: () => {
          this.keyboardMode = false;
          this.renderGhost();
        },
      },
      h('div', { class: 'ghost-row' }, this.ghost),
      board,
    );
  }

  private tryColumn(c: number) {
    if (!this.interactive) return;
    this.cursor = c;
    this.opts.onColumn(c);
  }

  private onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft') this.cursor = Math.max(0, this.cursor - 1);
    else if (e.key === 'ArrowRight') this.cursor = Math.min(COLS - 1, this.cursor + 1);
    else if (e.key === 'Enter' || e.key === ' ') this.tryColumn(this.cursor);
    else if (/^[1-7]$/.test(e.key)) {
      this.cursor = Number(e.key) - 1;
      this.tryColumn(this.cursor);
    } else return;
    e.preventDefault();
    this.keyboardMode = true;
    this.renderGhost();
  }

  private setHover(c: number) {
    this.hover = c;
    this.renderGhost();
  }

  private renderGhost() {
    // Always show the next disc above the board so new players see what they're about to drop.
    const col = this.hover >= 0 ? this.hover : this.cursor;
    const show = this.interactive && col >= 0 && this.model.canPlay(col);
    this.ghost.classList.toggle('show', show);
    this.ghost.classList.toggle('idle', show && this.hover < 0 && !this.keyboardMode);
    if (show) {
      this.ghost.style.setProperty('--c', String(col));
      this.ghost.style.setProperty('--disc', this.opts.color(this.ghostSide));
      this.ghost.dataset.side = String(this.ghostSide);
    }
  }

  setInteractive(on: boolean, side: Side = this.ghostSide) {
    this.interactive = on;
    this.ghostSide = side;
    this.el.classList.toggle('locked', !on);
    this.cols.forEach((b, c) => (b.disabled = !on || !this.model.canPlay(c)));
    this.renderGhost();
  }

  /** Redraws all discs instantly from a move list. */
  setPosition(moves: readonly number[]) {
    const draining = moves.length === 0 && this.discEls.size > 0 && !reducedMotion() && !document.hidden;
    if (draining) {
      this.drainAll();
      sfx.drain();
    }
    this.model = Board.from(moves);
    this.discs.replaceChildren();
    this.discEls.clear();
    const b = new Board();
    for (const m of moves) {
      const side = b.turn;
      const cell = b.play(m);
      this.addDisc(cell, side);
    }
    this.markLast();
    this.clearHighlight();
  }

  private addDisc(cell: number, side: Side): HTMLElement {
    const c = Math.floor(cell / ROWS);
    const r = cell % ROWS;
    const d = h('div', { class: 'disc', 'data-side': String(side) });
    d.style.setProperty('--c', String(c));
    d.style.setProperty('--r', String(r));
    d.style.setProperty('--disc', this.opts.color(side));
    this.discs.append(d);
    this.discEls.set(cell, d);
    return d;
  }

  private markLast() {
    this.discs.querySelectorAll('.last').forEach((x) => x.classList.remove('last'));
    const m = this.model.moves;
    if (!m.length) return;
    const c = m[m.length - 1];
    const cell = c * ROWS + this.model.heights[c] - 1;
    this.discEls.get(cell)?.classList.add('last');
  }

  /** Animates a disc into column c. Resolves when it lands. */
  async drop(c: number): Promise<void> {
    const side = this.model.turn;
    const cell = this.model.play(c);
    const r = cell % ROWS;
    const d = this.addDisc(cell, side);
    this.markLast();
    this.cols[c].disabled = !this.interactive || !this.model.canPlay(c);
    this.renderGhost();
    if (reducedMotion() || document.hidden) return;
    const fall = ROWS - r; // cells travelled (from the preview row)
    const { frames, duration, impactAt, bounceAt } = dropPhysics(fall, settings.get().animation === 'fast' ? 0.6 : 1);
    const anim = d.animate(frames, { duration, fill: 'backwards' });
    // Secondary bounce click + board thud happen in sync with the physics.
    if (bounceAt) setTimeout(() => sfx.bounce(fall), bounceAt);
    setTimeout(() => this.thud(fall), impactAt);
    // Resolve on first impact so sound/haptics land with the disc. Hidden tabs may pause animations,
    // so never let the game wait on one.
    void anim.finished.catch(() => undefined);
    await new Promise((res) => setTimeout(res, impactAt));
  }

  /** The board gives a little under a heavy disc. */
  private thud(fall: number) {
    if (reducedMotion()) return;
    const k = Math.min(1, fall / ROWS);
    this.boardEl.animate(
      [
        { transform: 'translateY(0)' },
        { transform: `translateY(${(1 + 2.5 * k).toFixed(2)}px)`, offset: 0.25 },
        { transform: `translateY(${(-0.6 * k).toFixed(2)}px)`, offset: 0.6 },
        { transform: 'translateY(0)' },
      ],
      { duration: 260, easing: 'ease-out' },
    );
  }

  /** New game: the "lever" releases and every disc falls out through the bottom. */
  private drainAll() {
    const els = [...this.discEls.entries()];
    this.drain.replaceChildren(...els.map(([, el]) => el));
    this.drain.classList.add('on');
    let longest = 0;
    for (const [cell, el] of els) {
      const c = Math.floor(cell / ROWS);
      const r = cell % ROWS;
      const dist = r + 1.2; // cells until it clears the bottom edge
      const t = Math.sqrt((2 * dist) / G) * 1000;
      const delay = c * 28 + Math.random() * 40;
      longest = Math.max(longest, t + delay);
      el.classList.remove('last', 'win');
      el.animate(
        [
          { transform: 'translateY(0)', easing: EASE_IN },
          { transform: `translateY(${dist * 100}%)` },
        ],
        { duration: t, delay, fill: 'forwards' },
      );
    }
    this.clearWinLine();
    setTimeout(() => {
      this.drain.replaceChildren();
      this.drain.classList.remove('on');
    }, longest + 60);
  }

  /** Removes the most recent disc (undo). */
  undo() {
    const c = this.model.moves[this.model.moves.length - 1];
    if (c === undefined) return;
    const cell = c * ROWS + this.model.heights[c] - 1;
    this.model.undo();
    const el = this.discEls.get(cell);
    this.discEls.delete(cell);
    if (el && !reducedMotion()) {
      const r = cell % ROWS;
      el.animate(
        [
          { transform: 'translateY(0)', opacity: 1, easing: 'cubic-bezier(.3,0,.2,1)' },
          { transform: `translateY(${-(ROWS - r) * 100}%)`, opacity: 0 },
        ],
        { duration: 260 + (ROWS - r) * 25, fill: 'forwards' },
      ).finished.then(
        () => el.remove(),
        () => el.remove(),
      );
    } else el?.remove();
    this.markLast();
    this.clearHighlight();
  }

  highlight(lines: Line[]) {
    const cells = new Set(lines.flat());
    this.el.classList.add('has-win');
    for (const [cell, el] of this.discEls) el.classList.toggle('win', cells.has(cell));
    this.clearWinLine();
    const motion = !reducedMotion();
    lines.forEach((line, li) => {
      // Order the line's cells from one end to the other.
      const pts = line.map((cell) => ({ cell, x: Math.floor(cell / ROWS) + 0.5, y: ROWS - (cell % ROWS) - 0.5 }));
      pts.sort((p, q) => p.x - q.x || q.y - p.y);
      if (motion)
        pts.forEach((p, i) =>
          this.discEls.get(p.cell)?.animate(
            [{ transform: 'scale(1)' }, { transform: 'scale(1.16)', offset: 0.4 }, { transform: 'scale(.97)', offset: 0.75 }, { transform: 'scale(1)' }],
            { duration: 420, delay: 120 + li * 200 + i * 80, easing: 'ease-out' },
          ),
        );
      const a = pts[0];
      const b = pts[pts.length - 1];
      const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      ln.setAttribute('x1', String(a.x));
      ln.setAttribute('y1', String(a.y));
      ln.setAttribute('x2', String(b.x));
      ln.setAttribute('y2', String(b.y));
      ln.setAttribute('pathLength', '1');
      if (motion) ln.style.animationDelay = `${450 + li * 200}ms`;
      this.winSvg.append(ln);
    });
  }

  private clearWinLine() {
    this.winSvg.replaceChildren();
  }

  clearHighlight() {
    this.clearWinLine();
    this.el.classList.remove('has-win');
    this.discEls.forEach((el) => el.classList.remove('win'));
  }

  /** Briefly highlights a column (hint). */
  flashColumn(c: number) {
    const b = this.cols[c];
    b.classList.remove('hint');
    void b.offsetWidth;
    b.classList.add('hint');
    setTimeout(() => b.classList.remove('hint'), 2400);
  }

  shake() {
    if (reducedMotion()) return;
    this.el.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }],
      { duration: 220 },
    );
  }

  recolor() {
    for (const el of this.discs.children) {
      const side = Number((el as HTMLElement).dataset.side) as Side;
      (el as HTMLElement).style.setProperty('--disc', this.opts.color(side));
    }
    this.renderGhost();
  }

  focus() {
    this.el.focus({ preventScroll: true });
  }
}

/* ---------- Drop physics ----------
 * Units are cells. Gravity is tuned so a full six-row fall takes ~0.4 s, which
 * reads as "real" on a phone-sized board. Restitution 0.3 gives one clear bounce
 * and a tiny second one, like a plastic disc in a plastic frame. */
const G = 75; // cells / s²
const E = 0.3; // coefficient of restitution
const EASE_IN = 'cubic-bezier(.333,0,.667,.333)'; // exact quadratic (free fall)
const EASE_OUT = 'cubic-bezier(.333,.667,.667,1)'; // exact quadratic (rising against gravity)

export function dropPhysics(fall: number, speed = 1) {
  const g = G / (speed * speed);
  const tFall = Math.sqrt((2 * fall) / g);
  const v = g * tFall;
  const segs: { t: number; h: number }[] = []; // bounce durations & apex heights
  let vb = v * E;
  for (let i = 0; i < 2 && vb > 1.2; i++) {
    segs.push({ t: (2 * vb) / g, h: (vb * vb) / (2 * g) });
    vb *= E;
  }
  const squash = 0.07; // squash time (s)
  const total = tFall + squash + segs.reduce((n, s) => n + s.t, 0) + 0.05;
  const at = (t: number) => Math.min(1, t / total);
  const k = Math.min(1, fall / ROWS);
  const sq = (x: number, y: number) => `scale(${(1 + x * k).toFixed(3)}, ${(1 - y * k).toFixed(3)})`;
  const frames: Keyframe[] = [
    { offset: 0, transform: `translateY(${-fall * 100}%) scale(.96, 1.05)`, easing: EASE_IN },
    { offset: at(tFall), transform: `translateY(0) ${sq(0.1, 0.12)}`, easing: 'ease-out' },
  ];
  let t = tFall + squash;
  frames.push({ offset: at(t), transform: 'translateY(0) scale(1, 1)', easing: EASE_OUT });
  segs.forEach((s, i) => {
    frames.push({ offset: at(t + s.t / 2), transform: `translateY(${(-s.h * 100).toFixed(1)}%)`, easing: EASE_IN });
    t += s.t;
    frames.push({ offset: at(t), transform: `translateY(0) ${i === 0 ? sq(0.04, 0.05) : 'scale(1, 1)'}`, easing: 'ease-out' });
  });
  frames.push({ offset: 1, transform: 'translateY(0) scale(1, 1)' });
  return {
    frames,
    duration: total * 1000,
    impactAt: tFall * 1000,
    bounceAt: segs.length ? (tFall + squash + segs[0].t) * 1000 : 0,
  };
}
