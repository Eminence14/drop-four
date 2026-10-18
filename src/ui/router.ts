export interface Screen {
  el: HTMLElement;
  /** Called when the screen is removed. */
  destroy?: () => void;
  /** Return false to block leaving (e.g. confirm dialog shown). */
  canLeave?: () => boolean | Promise<boolean>;
}
export type ScreenFactory = () => Screen;

const stack: ScreenFactory[] = [];
let current: Screen | null = null;
let root: HTMLElement;
let suppressPop = false;

type Dir = 'forward' | 'back' | 'fade';

const reduced = () =>
  document.documentElement.dataset.anim === 'reduced' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function swap(f: ScreenFactory) {
  current?.destroy?.();
  current = f();
  root.replaceChildren(current.el);
  window.scrollTo(0, 0);
  const focusTarget = current.el.querySelector<HTMLElement>('[autofocus], h1, .board-wrap');
  focusTarget?.focus?.({ preventScroll: true });
}

/**
 * Swaps screens with a directional slide. Uses the View Transitions API where
 * available (so the home board can morph into the game board), and a light
 * slide-in fallback elsewhere.
 */
function mount(f: ScreenFactory, dir: Dir = 'fade') {
  const first = !current;
  if (first || reduced() || document.hidden) return swap(f);
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
  const html = document.documentElement;
  if (doc.startViewTransition) {
    html.dataset.nav = dir;
    try {
      const vt = doc.startViewTransition(() => swap(f)) as { finished: Promise<void>; ready?: Promise<void> };
      // A skipped transition (rapid taps, hidden tab) rejects these; the swap still happened.
      vt.ready?.catch(() => undefined);
      vt.finished
        .catch(() => undefined)
        .finally(() => {
          if (html.dataset.nav === dir) delete html.dataset.nav;
        });
      return;
    } catch {
      /* fall through */
    }
  }
  swap(f);
  const x = dir === 'forward' ? 36 : dir === 'back' ? -36 : 0;
  current!.el.animate(
    [
      { opacity: 0, transform: `translateX(${x}px) scale(${dir === 'fade' ? 0.98 : 1})` },
      { opacity: 1, transform: 'none' },
    ],
    { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' },
  );
}

export const nav = {
  depth: () => stack.length,
  init(el: HTMLElement, home: ScreenFactory) {
    root = el;
    stack.length = 0;
    stack.push(home);
    history.replaceState({ df: 0 }, '');
    mount(home);
    window.addEventListener('popstate', async () => {
      if (suppressPop) {
        suppressPop = false;
        return;
      }
      if (current?.canLeave && !(await current.canLeave())) {
        // Re-push so the user stays.
        history.pushState({ df: stack.length - 1 }, '');
        return;
      }
      if (stack.length > 1) stack.pop();
      mount(stack[stack.length - 1], 'back');
    });
  },
  /** Navigate forward to a new screen. */
  go(f: ScreenFactory) {
    stack.push(f);
    history.pushState({ df: stack.length - 1 }, '');
    mount(f, 'forward');
  },
  /** Replace current screen without adding history. */
  replace(f: ScreenFactory) {
    stack[stack.length - 1] = f;
    mount(f);
  },
  back() {
    if (stack.length > 1) history.back();
  },
  /** Back to home, collapsing history. */
  home() {
    const n = stack.length - 1;
    if (n <= 0) return mount(stack[0], 'back');
    stack.length = 1;
    suppressPop = true;
    history.go(-n);
    mount(stack[0], 'back');
  },
};
