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

function mount(f: ScreenFactory) {
  current?.destroy?.();
  current = f();
  root.replaceChildren(current.el);
  current.el.classList.add('enter');
  window.scrollTo(0, 0);
  const focusTarget = current.el.querySelector<HTMLElement>('[autofocus], h1, .board-wrap');
  focusTarget?.focus?.({ preventScroll: true });
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
      mount(stack[stack.length - 1]);
    });
  },
  /** Navigate forward to a new screen. */
  go(f: ScreenFactory) {
    stack.push(f);
    history.pushState({ df: stack.length - 1 }, '');
    mount(f);
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
    if (n <= 0) return mount(stack[0]);
    stack.length = 1;
    suppressPop = true;
    history.go(-n);
    mount(stack[0]);
  },
};
