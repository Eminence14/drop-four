import { settings } from './store';

/* ---------- Sound (synthesised, works offline, zero assets) ---------- */
let ctx: AudioContext | null = null;
function ac(): AudioContext | null {
  if (!settings.get().sound) return null;
  try {
    ctx ??= new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; slide?: number; delay?: number } = {}) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + (opts.delay ?? 0);
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = opts.type ?? 'sine';
  o.frequency.setValueAtTime(freq, t);
  if (opts.slide) o.frequency.exponentialRampToValueAtTime(opts.slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.2, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const sfx = {
  drop(depth = 0) {
    tone(260 - depth * 12, 0.12, { type: 'triangle', slide: 90, gain: 0.28 });
    tone(1400, 0.03, { type: 'square', gain: 0.03 });
  },
  win() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { type: 'triangle', gain: 0.18, delay: i * 0.09 }));
  },
  lose() {
    [392, 330, 262].forEach((f, i) => tone(f, 0.25, { type: 'sine', gain: 0.16, delay: i * 0.12 }));
  },
  draw() {
    tone(440, 0.18, { gain: 0.14 });
    tone(440, 0.18, { gain: 0.14, delay: 0.2 });
  },
  invalid() {
    tone(140, 0.12, { type: 'sawtooth', gain: 0.06 });
  },
  tick() {
    tone(880, 0.05, { gain: 0.06 });
  },
  join() {
    tone(660, 0.1, { gain: 0.14 });
    tone(990, 0.14, { gain: 0.14, delay: 0.1 });
  },
};

export function buzz(pattern: number | number[]) {
  if (!settings.get().haptics) return;
  if ((navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive === false) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* ignore */
  }
}

export function reducedMotion(): boolean {
  return (
    settings.get().animation === 'reduced' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

/* ---------- Confetti ---------- */
export function confetti(colors: string[]) {
  if (reducedMotion()) return;
  const c = document.createElement('canvas');
  c.className = 'confetti';
  c.setAttribute('aria-hidden', 'true');
  document.body.append(c);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = (c.width = innerWidth * dpr);
  const H = (c.height = innerHeight * dpr);
  const g = c.getContext('2d')!;
  const N = Math.min(140, Math.round(innerWidth / 4));
  const parts = Array.from({ length: N }, () => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.3,
    y: H * 0.35,
    vx: (Math.random() - 0.5) * 22 * dpr,
    vy: (-Math.random() * 18 - 6) * dpr,
    r: (4 + Math.random() * 5) * dpr,
    rot: Math.random() * 6,
    vr: (Math.random() - 0.5) * 0.4,
    col: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  const frame = (t: number) => {
    const el = t - t0;
    g.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.6 * dpr;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      g.save();
      g.globalAlpha = Math.max(0, 1 - el / 1800);
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.fillStyle = p.col;
      g.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
      g.restore();
    }
    if (el < 1800) requestAnimationFrame(frame);
    else c.remove();
  };
  requestAnimationFrame(frame);
}

/* ---------- Screen-reader announcements ---------- */
export function announce(msg: string) {
  const el = document.getElementById('sr-live');
  if (!el) return;
  el.textContent = '';
  setTimeout(() => (el.textContent = msg), 30);
}

/* ---------- Toasts ---------- */
export function toast(msg: string, opts: { action?: string; onAction?: () => void; ms?: number } = {}) {
  const host = document.getElementById('toasts')!;
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = msg;
  if (opts.action) {
    const b = document.createElement('button');
    b.className = 'toast-action';
    b.textContent = opts.action;
    b.onclick = () => {
      opts.onAction?.();
      t.remove();
    };
    t.append(b);
  }
  host.append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  if (opts.ms !== 0)
    setTimeout(() => {
      t.classList.remove('in');
      setTimeout(() => t.remove(), 300);
    }, opts.ms ?? 2600);
  return t;
}
