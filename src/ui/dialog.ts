import { h } from './dom';

/** Accessible in-app confirm dialog (never uses window.confirm). */
export function confirmDialog(title: string, body: string, ok = 'OK', cancel = 'Cancel'): Promise<boolean> {
  return new Promise((resolve) => {
    const prev = document.activeElement as HTMLElement | null;
    const close = (v: boolean) => {
      wrap.classList.remove('in');
      setTimeout(() => wrap.remove(), 180);
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
    };
    const okBtn = h('button', { class: 'btn primary', onclick: () => close(true) }, ok);
    const wrap = h(
      'div',
      { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-t' },
      h('div', { class: 'modal-backdrop', onclick: () => close(false) }),
      h(
        'div',
        { class: 'modal-card' },
        h('h2', { id: 'dlg-t' }, title),
        h('p', null, body),
        h('div', { class: 'modal-btns' }, h('button', { class: 'btn', onclick: () => close(false) }, cancel), okBtn),
      ),
    );
    document.body.append(wrap);
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => {
      wrap.classList.add('in');
      okBtn.focus();
    });
  });
}

/** Small dialog with one text field. Resolves to the new value, or null if cancelled. */
export function promptDialog(title: string, value: string, opts: { maxLength?: number; ok?: string } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    const input = h('input', { class: 'input', value, maxlength: String(opts.maxLength ?? 16), 'aria-label': title }) as HTMLInputElement;
    const close = (v: string | null) => {
      wrap.classList.remove('in');
      setTimeout(() => wrap.remove(), 180);
      resolve(v);
    };
    const form = h('form', { class: 'modal-card', onsubmit: (e: Event) => { e.preventDefault(); close(input.value); } },
      h('h2', null, title),
      input,
      h('div', { class: 'modal-btns' },
        h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Cancel'),
        h('button', { class: 'btn primary', type: 'submit' }, opts.ok ?? 'Save'),
      ),
    );
    const wrap = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', onkeydown: (e: KeyboardEvent) => e.key === 'Escape' && close(null) },
      h('div', { class: 'modal-backdrop', onclick: () => close(null) }),
      form,
    );
    document.body.append(wrap);
    requestAnimationFrame(() => {
      wrap.classList.add('in');
      input.focus();
      input.select();
    });
  });
}

/** Bottom sheet. Returns a close function. */
export function sheet(title: string, body: HTMLElement): () => void {
  const prev = document.activeElement as HTMLElement | null;
  const close = () => {
    wrap.classList.remove('in');
    setTimeout(() => wrap.remove(), 220);
    document.removeEventListener('keydown', onKey);
    prev?.focus?.();
  };
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
  const handle = h('div', { class: 'sheet-handle' },
    h('div', { class: 'sheet-grab', 'aria-hidden': 'true' }),
    h('h2', { class: 'sheet-title' }, title),
  );
  const card = h('div', { class: 'sheet-card' }, handle, body);
  const backdrop = h('div', { class: 'modal-backdrop', onclick: () => close() });
  const wrap = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, backdrop, card);
  dragToDismiss(handle, card, backdrop, () => close());
  document.body.append(wrap);
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => {
    wrap.classList.add('in');
    (body.querySelector('button') as HTMLElement | null)?.focus({ preventScroll: true });
  });
  return close;
}

/**
 * Pull a sheet down by its handle. Releases past a third of its height, or with a
 * downward flick, dismiss it; anything less springs back.
 */
function dragToDismiss(handle: HTMLElement, card: HTMLElement, backdrop: HTMLElement, close: () => void) {
  let startY = 0;
  let dy = 0;
  let samples: { y: number; t: number }[] = [];
  let dragging = false;
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    startY = e.clientY;
    dy = 0;
    samples = [{ y: e.clientY, t: e.timeStamp }];
    handle.setPointerCapture(e.pointerId);
    card.classList.add('dragging');
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const raw = e.clientY - startY;
    // Rubber-band when pulled upwards.
    dy = raw > 0 ? raw : -Math.sqrt(-raw) * 3;
    card.style.transform = `translateY(${dy}px)`;
    backdrop.style.opacity = String(Math.max(0.2, 1 - Math.max(0, dy) / (card.offsetHeight || 1)));
    samples.push({ y: e.clientY, t: e.timeStamp });
    if (samples.length > 6) samples.shift();
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    card.classList.remove('dragging');
    const a = samples[0];
    const b = samples[samples.length - 1];
    const v = b && a && b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0; // px/ms
    backdrop.style.opacity = '';
    card.style.transform = '';
    if (dy > card.offsetHeight / 3 || v > 0.55) close();
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}
