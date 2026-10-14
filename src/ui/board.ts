import { Board, COLS, ROWS, type Line, type Side } from '../engine/game';
import { h } from './dom';
import { reducedMotion } from './fx';
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
    const board = h('div', { class: 'board' }, this.discs, frame, colsWrap);
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
    const fall = ROWS - r; // rows travelled (from ghost row)
    const speed = settings.get().animation === 'fast' ? 0.55 : 1;
    const dur = (170 + fall * 55) * speed;
    const anim = d.animate(
      [
        { transform: `translateY(${-fall * 100}%)`, easing: 'cubic-bezier(.5,0,1,1)' },
        { transform: 'translateY(0)', offset: 0.72, easing: 'cubic-bezier(0,0,.4,1)' },
        { transform: `translateY(${-Math.min(14, fall * 3)}%)`, offset: 0.86, easing: 'cubic-bezier(.6,0,1,1)' },
        { transform: 'translateY(0)' },
      ],
      { duration: dur },
    );
    // Hidden tabs may pause animations; never let the game wait on one.
    await Promise.race([anim.finished.catch(() => undefined), new Promise((r) => setTimeout(r, dur + 120))]);
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
      el.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.6)' }], { duration: 160 }).finished.then(
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
  }

  clearHighlight() {
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
