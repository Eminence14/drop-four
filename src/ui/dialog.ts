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
  const wrap = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-backdrop', onclick: () => close() }),
    h('div', { class: 'sheet-card' },
      h('div', { class: 'sheet-grab', 'aria-hidden': 'true' }),
      h('h2', { class: 'sheet-title' }, title),
      body,
    ),
  );
  document.body.append(wrap);
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => {
    wrap.classList.add('in');
    (body.querySelector('button') as HTMLElement | null)?.focus({ preventScroll: true });
  });
  return close;
}
