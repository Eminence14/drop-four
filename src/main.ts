import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { LEVEL_INFO, LEVELS, type Level } from './ai/search';
import { normalizeCode } from './online/types';
import { timerPicker, type TimerSpec } from './ui/timer';
import { confirmDialog, sheet } from './ui/dialog';
import { h, icon } from './ui/dom';
import { toast } from './ui/fx';
import { loadResume, localGameScreen, type LocalGameState } from './ui/local';

/* Online UI (and its QR library) is code-split: offline players never download it. */
const onlineUI = () => import('./ui/online');
const lastRoom = () => storage.raw<{ code: string }>('online');
const rejoinLast = () => onlineUI().then((m) => m.rejoinLast()).catch(() => toast('Could not load online play — check your connection.'));
const goOnline = (code = '') =>
  onlineUI()
    .then((m) => nav.go(() => m.onlineEntryScreen(code)))
    .catch(() => toast('Could not load online play — check your connection.'));
import { nav, type Screen } from './ui/router';
import { aiRecord, colorHex, PALETTE, sanitizeName, settings, storage, type ColorId, type Settings, AVATARS, initials } from './ui/store';

/* ---------------- Theme ---------------- */
function applyTheme() {
  const s = settings.get();
  const root = document.documentElement;
  if (s.theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', s.theme);
  root.toggleAttribute('data-patterns', s.patterns);
  root.dataset.anim = s.animation;
  const dark = s.theme === 'dark' || (s.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0e1115' : '#ebe6dd');
}
settings.subscribe(applyTheme);
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
applyTheme();

/* ---------------- Install prompt ---------------- */
interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
let installEvent: BIPEvent | null = null;
const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e as BIPEvent;
  document.querySelectorAll('[data-install]').forEach((el) => ((el as HTMLElement).hidden = false));
});
addEventListener('appinstalled', () => {
  installEvent = null;
  document.querySelectorAll('[data-install]').forEach((el) => ((el as HTMLElement).hidden = true));
  toast('Installed! Find Drop Four on your home screen.');
});
async function install() {
  if (installEvent) {
    await installEvent.prompt();
    installEvent = null;
  } else if (isIOS()) {
    void confirmDialog('Install on iPhone', 'Tap the Share button in Safari, then choose "Add to Home Screen".', 'Got it', 'Close');
  }
}

/* ---------------- Service worker ---------------- */
const updateSW = registerSW({
  onNeedRefresh() {
    toast('Update available', { action: 'Reload', onAction: () => void updateSW(true), ms: 0 });
  },
  onOfflineReady() {
    toast('Ready to play offline');
  },
});

/* ---------------- Screens ---------------- */
/** Settings open as a sheet on top of whatever is on screen, so a game in progress is never torn down. */
const openSettings = () => {
  const close = sheet('Settings', settingsBody(() => close()));
};

/** Animated mini board on the home screen: shows what the game is in one glance. */
function heroBoard(): HTMLElement {
  const seq = [3, 3, 2, 4, 4, 2, 5, 1, 1];
  const grid = h('div', { class: 'hero-board', 'aria-hidden': 'true' });
  const cells: HTMLElement[] = [];
  for (let r = 5; r >= 0; r--) for (let c = 0; c < 7; c++) {
    const cell = h('span', { class: 'hero-cell', 'data-c': String(c), 'data-r': String(r) });
    cells.push(cell);
    grid.append(cell);
  }
  const at = (c: number, r: number) => cells.find((x) => x.dataset.c === String(c) && x.dataset.r === String(r))!;
  let i = 0;
  const heights = Array(7).fill(0);
  const tick = () => {
    if (!grid.isConnected) return;
    if (i >= seq.length + 3) {
      cells.forEach((x) => (x.className = 'hero-cell'));
      heights.fill(0);
      i = 0;
    } else if (i < seq.length) {
      const c = seq[i];
      const cell = at(c, heights[c]++);
      cell.className = `hero-cell p${i % 2} drop`;
      cell.style.setProperty('--fall', String(6 - heights[c] + 1));
      if (i === seq.length - 1) [2, 3, 4, 5].forEach((cc, k) => at(cc, [0, 1, 2, 3][k]).classList.add('win'));
    }
    i++;
    setTimeout(tick, i === 1 ? 500 : 650);
  };
  setTimeout(tick, 400);
  return grid;
}

function startPvp(timer: TimerSpec | null) {
  const s = settings.get();
  const c2 = s.color2 === s.color1 ? (PALETTE.find((p) => p.id !== s.color1)!.id as ColorId) : s.color2;
  settings.set({ timer2p: timer });
  const st: LocalGameState = {
    mode: 'pvp',
    seats: [
      { name: s.name1 || 'Player 1', color: s.color1, kind: 'human', avatar: s.avatar1 },
      { name: s.name2 || 'Player 2', color: c2, kind: 'human', avatar: s.avatar2 },
    ],
    firstSeat: 0,
    moves: [],
    score: [0, 0],
    draws: 0,
    timer,
  };
  nav.go(() => localGameScreen(st, openSettings));
}

/** 2 Players: one sheet with the (optional) timer, then Start. */
function openPvpSheet() {
  const picker = timerPicker(settings.get().timer2p);
  let close = () => {};
  const startBtn = h('button', { class: 'btn primary big', 'data-id': 'start', onclick: () => { const t = picker.get(); close(); startPvp(t); } }, 'Start game');
  close = sheet('2 Players', h('div', { class: 'sheet-body' },
    h('p', { class: 'muted center' }, 'Take turns on this phone. Add a timer for a faster, tenser game.'),
    picker.el,
    startBtn,
  ));
  requestAnimationFrame(() => startBtn.focus());
}

function startAI(level: Level) {
  const s = settings.get();
  const aiColor = s.color2 === s.color1 ? (PALETTE.find((p) => p.id !== s.color1)!.id as ColorId) : s.color2;
  settings.set({ aiLevel: level });
  const st: LocalGameState = {
    mode: 'ai',
    level,
    seats: [
      { name: 'You', color: s.color1, kind: 'human', avatar: s.avatar1 },
      { name: 'Computer', color: aiColor, kind: 'ai', avatar: '🤖' },
    ],
    firstSeat: 0,
    moves: [],
    score: [0, 0],
    draws: 0,
  };
  nav.go(() => localGameScreen(st, openSettings));
}

/** One tap: pick a level and the game starts. */
function openAiSheet() {
  void import('./ai/client').then((m) => m.ai.warm());
  const rec = aiRecord();
  const current = settings.get().aiLevel;
  let close = () => {};
  const list = h('div', { class: 'levels' },
    ...LEVELS.map((l, i) => {
      const r = rec[l];
      const played = r.w + r.l + r.d;
      return h('button', { class: 'level', 'data-level': l, 'aria-current': l === current ? 'true' : undefined, onclick: () => { close(); startAI(l); } },
        h('span', { class: 'level-pips', 'aria-hidden': 'true' }, ...Array.from({ length: 5 }, (_, k) => h('i', { class: k <= i ? 'on' : '' }))),
        h('span', { class: 'level-name' }, LEVEL_INFO[l].label, l === current ? h('span', { class: 'tag' }, 'Last played') : null),
        h('span', { class: 'level-blurb' }, LEVEL_INFO[l].blurb),
        h('span', { class: 'level-rec' }, played ? `${r.w}–${r.l}` : ''),
      );
    }),
  );
  close = sheet('Choose a level', h('div', { class: 'sheet-body' }, list, h('p', { class: 'muted small center' }, 'You go first. Works offline.')));
}

function homeScreen(): Screen {
  const resume = loadResume();
  const room = lastRoom();
  const offline = !navigator.onLine;
  const modeBtn = (o: { id: string; title: string; sub: string; ic: Element; onClick: () => void; disabled?: boolean }) =>
    h('button', { class: 'mode-btn', 'data-id': o.id, onclick: o.onClick, disabled: o.disabled },
      h('span', { class: 'mode-ic' }, o.ic),
      h('span', { class: 'mode-text' }, h('span', { class: 'mode-title' }, o.title), h('span', { class: 'mode-sub' }, o.sub)),
      h('span', { class: 'mode-go', 'aria-hidden': 'true' }, '›'),
    );
  const pair = (a: string, b: string) => h('span', { class: 'pair' }, h('i', { style: `--disc:${a}` }), h('i', { style: `--disc:${b}` }));
  const s = settings.get();
  const el = h('section', { class: 'screen home' },
    h('header', { class: 'home-head' },
      h('span', { class: 'spacer' }),
      h('button', { class: 'icon-btn', 'aria-label': 'Settings', onclick: openSettings }, icon('gear')),
    ),
    h('div', { class: 'brand' },
      heroBoard(),
      h('h1', { tabindex: '-1' }, 'Drop Four'),
      h('p', { class: 'tagline' }, 'Get four in a row to win.'),
    ),
    resume
      ? h('button', { class: 'resume', onclick: () => nav.go(() => localGameScreen(resume, openSettings)) },
          h('span', null, h('strong', null, 'Continue game'), h('span', { class: 'muted small block' },
            resume.mode === 'ai' ? `vs Computer · ${LEVEL_INFO[resume.level!].label}` : '2 Players')),
          h('span', { class: 'mode-go', 'aria-hidden': 'true' }, '›'),
        )
      : room && !offline
        ? h('button', { class: 'resume', onclick: () => void rejoinLast() },
            h('span', null, h('strong', null, 'Back to your online game'), h('span', { class: 'muted small block' }, `Room ${room.code}`)),
            h('span', { class: 'mode-go', 'aria-hidden': 'true' }, '›'),
          )
        : null,
    h('nav', { class: 'modes', 'aria-label': 'Choose how to play' },
      modeBtn({ id: 'ai', title: 'vs Computer', sub: 'Play alone · 5 levels', ic: pair(colorHex(s.color1), '#8b93b8'), onClick: openAiSheet }),
      modeBtn({ id: 'pvp', title: '2 Players', sub: 'Take turns on this phone', ic: pair(colorHex(s.color1), colorHex(s.color2)), onClick: openPvpSheet }),
      modeBtn({ id: 'online', title: 'Play a friend online', sub: offline ? 'Needs internet' : 'They join with a code', ic: icon('globe'), onClick: () => void goOnline() }),
    ),
    h('div', { class: 'home-foot' },
      h('button', { class: 'link-btn', onclick: () => nav.go(helpScreen) }, 'How to play'),
      h('button', { class: 'link-btn', 'data-install': '', hidden: !(installEvent || (isIOS() && !isStandalone())), onclick: () => void install() }, 'Install app'),
    ),
  );
  return { el };
}

function colorPicker(name: string, value: ColorId, disabled: ColorId | null, onPick: (c: ColorId) => void) {
  const wrap = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': `${name} colour` });
  const render = (val: ColorId, dis: ColorId | null) => {
    wrap.replaceChildren(
      ...PALETTE.map((p) =>
        h('button', {
          class: 'swatch',
          type: 'button',
          role: 'radio',
          'aria-checked': String(p.id === val),
          'aria-label': p.name,
          disabled: p.id === dis,
          style: `--disc:${p.hex}`,
          onclick: () => onPick(p.id),
        }),
      ),
    );
  };
  render(value, disabled);
  return { el: wrap, render };
}

function settingsBody(onDone: () => void): HTMLElement {
  const body = h('div', { class: 'form settings-body' });
  const seg = <T extends string>(label: string, options: [T, string][], get: () => T, set: (v: T) => void) => {
    const g = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
    const render = () =>
      g.replaceChildren(...options.map(([v, l]) => h('button', { role: 'radio', 'aria-checked': String(get() === v), onclick: () => { set(v); render(); } }, l)));
    render();
    return h('div', { class: 'setting' }, h('span', { class: 'label' }, label), g);
  };
  const toggle = (label: string, get: () => boolean, set: (v: boolean) => void, hint = '') => {
    const id = 't-' + label.replace(/\W/g, '');
    const input = h('input', { type: 'checkbox', id, role: 'switch', class: 'switch', onchange: () => set(input.checked) }) as HTMLInputElement;
    input.checked = get();
    return h('div', { class: 'setting row-between' },
      h('label', { for: id }, h('span', { class: 'label-inline' }, label), hint ? h('span', { class: 'muted small block' }, hint) : null),
      input,
    );
  };
  const s = () => settings.get();
  const preview = h('div', { class: 'disc-preview', 'aria-hidden': 'true' },
    h('span', { class: 'disc', 'data-side': '0', style: `--disc:${colorHex(s().color1)}` }),
    h('span', { class: 'disc', 'data-side': '1', style: `--disc:${colorHex(s().color2)}` }),
  );
  let c1 = s().color1;
  let c2 = s().color2;
  const pick1 = colorPicker('Player 1', c1, c2, (c) => { c1 = c; settings.set({ color1: c }); pick1.render(c1, c2); pick2.render(c2, c1); });
  const pick2 = colorPicker('Player 2', c2, c1, (c) => { c2 = c; settings.set({ color2: c }); pick1.render(c1, c2); pick2.render(c2, c1); });
  const nameInput = (key: 'name1' | 'name2', label: string) => {
    const i = h('input', { class: 'input', maxlength: '16', value: s()[key], 'aria-label': label,
      onchange: () => settings.set({ [key]: sanitizeName(i.value, label) } as Partial<Settings>) }) as HTMLInputElement;
    return i;
  };
  const avatarPicker = (key: 'avatar1' | 'avatar2', nameKey: 'name1' | 'name2', colorKey: 'color1' | 'color2') => {
    const wrap = h('div', { class: 'avatars', role: 'radiogroup', 'aria-label': 'Avatar' });
    const render = () =>
      wrap.replaceChildren(
        ...AVATARS.map((a) =>
          h('button', {
            type: 'button', role: 'radio', class: 'avatar-opt' + (a ? ' emoji' : ''),
            'aria-checked': String(s()[key] === a), 'aria-label': a || 'Initials',
            style: `--disc:${colorHex(s()[colorKey])}`,
            onclick: () => { settings.set({ [key]: a } as Partial<Settings>); render(); },
          }, a || initials(s()[nameKey] || 'P')),
        ),
      );
    render();
    return wrap;
  };
  body.append(
    h('div', { class: 'setting' }, h('span', { class: 'label' }, 'Player 1 (you, vs Computer and online)'), nameInput('name1', 'Player 1'), avatarPicker('avatar1', 'name1', 'color1'), pick1.el),
    h('div', { class: 'setting' }, h('span', { class: 'label' }, 'Player 2'), nameInput('name2', 'Player 2'), avatarPicker('avatar2', 'name2', 'color2'), pick2.el),
    seg('Theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], () => s().theme, (v) => settings.set({ theme: v })),
    seg('Animation', [['normal', 'Normal'], ['fast', 'Fast'], ['reduced', 'Reduced']], () => s().animation, (v) => settings.set({ animation: v })),
    toggle('Sound', () => s().sound, (v) => settings.set({ sound: v })),
    toggle('Vibration', () => s().haptics, (v) => settings.set({ haptics: v }), 'On supported phones'),
    toggle('Disc symbols', () => s().patterns, (v) => settings.set({ patterns: v }), 'Adds shapes so colour is never the only clue'),
    preview,
    h('div', { class: 'setting' },
      h('button', { class: 'btn danger small', onclick: async () => {
        if (await confirmDialog('Reset all data?', 'This clears names, settings, AI records and saved games on this device.', 'Reset', 'Cancel')) {
          storage.clearAll();
          settings.reset();
          toast('All local data cleared');
        }
      } }, 'Reset all local data'),
    ),
    h('p', { class: 'muted small center' }, `Drop Four v${__APP_VERSION__}`),
  );
  body.append(h('button', { class: 'btn primary big', onclick: onDone }, 'Done'));
  return body;
}

function miniBoard(cells: string): HTMLElement {
  // cells: 6 rows top→bottom of 7 chars: . a b w (w = winning a)
  const g = h('div', { class: 'mini', 'aria-hidden': 'true' });
  cells.split('/').forEach((row) =>
    row.split('').forEach((ch) => g.append(h('span', { class: 'mini-cell', 'data-v': ch }))),
  );
  return g;
}

function helpScreen(): Screen {
  settings.set({ hasSeenHelp: true });
  return {
    el: h('section', { class: 'screen form-screen help' },
      h('header', { class: 'topbar' },
        h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => nav.back() }, icon('back')),
        h('h1', { class: 'topbar-title', tabindex: '-1' }, 'How to play'),
        h('span', { class: 'icon-btn-spacer' }),
      ),
      h('div', { class: 'form' },
        h('div', { class: 'card' },
          h('h2', null, 'The goal'),
          h('p', null, 'Take turns dropping discs into the 7 columns. Discs fall to the lowest free space. First to line up four in a row wins.'),
          h('div', { class: 'mini-row' },
            h('figure', null, miniBoard('......./......./......./......./......./.wwww..'), h('figcaption', null, 'Across')),
            h('figure', null, miniBoard('......./......./...w.../...w.../...w.../...w...'), h('figcaption', null, 'Down')),
            h('figure', null, miniBoard('......./......./.....w./....wb./...wab./..wbab.'), h('figcaption', null, 'Diagonal')),
          ),
          h('p', { class: 'muted' }, 'If the board fills up with no four-in-a-row, it\'s a draw.'),
        ),
        h('div', { class: 'card' },
          h('h2', null, 'Three tips'),
          h('ol', { class: 'tips' },
            h('li', null, h('strong', null, 'Own the centre. '), 'The middle column is part of the most possible lines.'),
            h('li', null, h('strong', null, 'Make two threats at once. '), 'Your opponent can only block one.'),
            h('li', null, h('strong', null, 'Watch the square above. '), 'Before you drop, check you aren\'t giving your opponent the spot they need on top.'),
          ),
        ),
        h('div', { class: 'card' },
          h('h2', null, 'Controls'),
          h('p', null, 'Tap any column to drop. On a keyboard, use ← → and Enter, or press 1–7.'),
        ),
        h('button', { class: 'btn primary big', onclick: () => nav.back() }, 'Got it'),
      ),
    ),
  };
}

/* ---------------- Boot ---------------- */
const app = document.getElementById('app')!;
nav.init(app, homeScreen);

// Deep link: /r/CODE or ?room=CODE
const deep = location.pathname.match(/^\/r\/([A-Za-z0-9]{4})\/?$/)?.[1] ?? new URLSearchParams(location.search).get('room');
if (deep && normalizeCode(deep).length === 4) {
  const code = normalizeCode(deep);
  history.replaceState({ df: 0 }, '', '/' + location.search.replace(/([?&])room=[^&]*&?/, '$1').replace(/[?&]$/, ''));
  void goOnline(code);
}

if (!deep && new URLSearchParams(location.search).get('mode') === 'ai') openAiSheet();
// Reopened/reloaded during an online game (never explicitly left): go straight back in.
else if (!deep && lastRoom() && navigator.onLine) void rejoinLast();
// Focus rings only for keyboard users (the board takes focus programmatically).
addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Tab' || e.key.startsWith('Arrow')) document.documentElement.dataset.kbd = '1'; }, true);
addEventListener('pointerdown', () => { delete document.documentElement.dataset.kbd; }, true);

addEventListener('online', () => document.querySelectorAll('.net').forEach((n) => ((n as HTMLElement).textContent = '')));
addEventListener('offline', () => toast("You're offline — Pass & Play and AI still work"));
