import { h, icon } from './dom';
import { BoardView, type BoardViewOptions } from './board';
import { settings } from './store';

export interface SeatView {
  name: string;
  color: string; // hex
  score?: number | string;
  sub?: string; // e.g. "AI · Hard", "Online", "You"
  online?: boolean | null; // presence dot (null = hide)
}

export interface ResultButton {
  label: string;
  primary?: boolean;
  onClick: () => void;
  icon?: Parameters<typeof icon>[0];
}

/** Shared game screen chrome: header, player chips, status, board, actions, result sheet. */
export class GameShell {
  readonly el: HTMLElement;
  readonly board: BoardView;
  private seatEls: HTMLElement[] = [];
  private statusEl: HTMLElement;
  private actionsEl: HTMLElement;
  private resultEl: HTMLElement;
  private extraEl: HTMLElement;
  private drawsEl: HTMLElement;

  constructor(o: {
    title: string;
    onBack: () => void;
    onSettings?: () => void;
    board: BoardViewOptions;
    titleExtra?: HTMLElement;
  }) {
    this.board = new BoardView(o.board);
    this.statusEl = h('div', { class: 'status', 'aria-live': 'off' });
    this.actionsEl = h('div', { class: 'actions' });
    this.resultEl = h('div', { class: 'result', role: 'dialog', 'aria-modal': 'false', hidden: true });
    this.extraEl = h('div', { class: 'extra' });
    this.drawsEl = h('div', { class: 'draws' });
    const seats = h('div', { class: 'seats' });
    for (let i = 0; i < 2; i++) {
      const s = h(
        'div',
        { class: 'seat', 'data-seat': String(i) },
        h('span', { class: 'seat-disc' }),
        h('span', { class: 'seat-text' }, h('span', { class: 'seat-name' }), h('span', { class: 'seat-sub' })),
        h('span', { class: 'seat-score' }),
      );
      this.seatEls.push(s);
      seats.append(s);
      if (i === 0) seats.append(this.drawsEl);
    }
    this.el = h(
      'section',
      { class: 'screen game' },
      h(
        'header',
        { class: 'topbar' },
        h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: o.onBack }, icon('back')),
        h('h1', { class: 'topbar-title' }, o.title, o.titleExtra ?? null),
        o.onSettings
          ? h('button', { class: 'icon-btn', 'aria-label': 'Settings', onclick: o.onSettings }, icon('gear'))
          : h('span', { class: 'icon-btn-spacer' }),
      ),
      seats,
      this.statusEl,
      h('div', { class: 'board-area' }, this.board.el),
      this.extraEl,
      this.actionsEl,
      this.resultEl,
    );
  }

  setSeat(i: number, v: SeatView) {
    const s = this.seatEls[i];
    s.style.setProperty('--disc', v.color);
    s.querySelector('.seat-name')!.textContent = v.name;
    s.querySelector('.seat-sub')!.textContent = v.sub ?? '';
    s.querySelector('.seat-score')!.textContent = v.score === undefined ? '' : String(v.score);
    s.dataset.online = v.online === undefined || v.online === null ? '' : v.online ? 'yes' : 'no';
    s.querySelector('.seat-disc')!.setAttribute('data-side', String(i));
    s.classList.toggle('patterned', settings.get().patterns);
  }

  setDraws(n: number) {
    this.drawsEl.textContent = n ? `${n} draw${n === 1 ? '' : 's'}` : '';
  }

  /** Marks which seat is to move (null = nobody). */
  setActive(i: number | null) {
    this.seatEls.forEach((s, k) => s.classList.toggle('active', k === i));
  }

  /** Turn banner. Pass a colour to show whose disc is up next. */
  setStatus(text: string, tone: 'normal' | 'thinking' | 'good' | 'bad' | 'muted' = 'normal', color?: string) {
    this.statusEl.replaceChildren(
      ...(color ? [h('span', { class: 'status-disc', style: `--disc:${color}` })] : []),
      h('span', { class: 'status-text' }, text),
    );
    this.statusEl.dataset.tone = tone;
    this.statusEl.classList.toggle('has-disc', Boolean(color));
  }

  /** First-game hint shown above the board until the first move. */
  coach(text: string | null) {
    this.el.querySelector('.coach')?.remove();
    if (!text) return;
    this.el.querySelector('.board-area')!.prepend(h('div', { class: 'coach', role: 'note' }, text, h('span', { class: 'coach-arrow', 'aria-hidden': 'true' }, '↓')));
  }

  /** Makes a seat tappable (e.g. to rename a player). */
  onSeatTap(i: number, label: string, fn: () => void) {
    const s = this.seatEls[i];
    s.setAttribute('role', 'button');
    s.setAttribute('tabindex', '0');
    s.setAttribute('aria-label', label);
    s.classList.add('tappable');
    s.addEventListener('click', fn);
    s.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fn();
      }
    });
  }

  setActions(buttons: (HTMLElement | null)[]) {
    this.actionsEl.replaceChildren(...buttons.filter(Boolean as unknown as (x: HTMLElement | null) => x is HTMLElement));
  }

  setExtra(node: HTMLElement | null) {
    this.extraEl.replaceChildren(...(node ? [node] : []));
  }

  showResult(title: string, subtitle: string, buttons: ResultButton[], color?: string) {
    this.resultEl.replaceChildren(
      h('div', { class: 'result-card' },
        h('div', { class: 'result-title', style: color ? `--disc:${color}` : undefined }, title),
        subtitle ? h('div', { class: 'result-sub' }, subtitle) : null,
        h('div', { class: 'result-btns' },
          buttons.map((b) =>
            h('button', { class: b.primary ? 'btn primary' : 'btn', onclick: b.onClick }, b.icon ? icon(b.icon) : null, b.label),
          ),
        ),
      ),
    );
    this.resultEl.hidden = false;
    requestAnimationFrame(() => this.resultEl.classList.add('in'));
    (this.resultEl.querySelector('.btn.primary') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  hideResult() {
    this.resultEl.classList.remove('in');
    this.resultEl.hidden = true;
  }
}

export function actionButton(label: string, ic: Parameters<typeof icon>[0], onClick: () => void, opts: { disabled?: boolean; id?: string } = {}) {
  return h('button', { class: 'btn ghost small', onclick: onClick, disabled: opts.disabled, 'data-id': opts.id }, icon(ic), label);
}
