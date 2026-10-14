import type { Level } from '../ai/search';

/** localStorage access that never throws (private mode, blocked storage, etc.). */
export const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem('df.' + key);
      return raw === null ? fallback : { ...fallbackShape(fallback), ...JSON.parse(raw) } as T;
    } catch {
      return fallback;
    }
  },
  raw<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem('df.' + key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem('df.' + key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem('df.' + key);
    } catch {
      /* ignore */
    }
  },
  clearAll() {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('df.'))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
  },
};
function fallbackShape<T>(f: T): object {
  return f && typeof f === 'object' && !Array.isArray(f) ? (f as object) : {};
}

export const PALETTE = [
  { id: 'coral', name: 'Coral', hex: '#FF6B4A' },
  { id: 'blue', name: 'Blue', hex: '#3D7BFD' },
  { id: 'gold', name: 'Gold', hex: '#FFC233' },
  { id: 'mint', name: 'Mint', hex: '#1FC79A' },
  { id: 'violet', name: 'Violet', hex: '#9D6BFF' },
  { id: 'pink', name: 'Pink', hex: '#FF5FA2' },
] as const;
export type ColorId = (typeof PALETTE)[number]['id'];
export const colorHex = (id: string) => PALETTE.find((p) => p.id === id)?.hex ?? '#888';
export const colorName = (id: string) => PALETTE.find((p) => p.id === id)?.name ?? id;

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  sound: boolean;
  haptics: boolean;
  animation: 'normal' | 'fast' | 'reduced';
  patterns: boolean;
  name1: string;
  name2: string;
  color1: ColorId;
  color2: ColorId;
  onlineName: string;
  aiLevel: Level;
  aiFirst: 'me' | 'ai' | 'random';
  hasSeenHelp: boolean;
}

const DEFAULTS: Settings = {
  theme: 'system',
  sound: true,
  haptics: true,
  animation: 'normal',
  patterns: false,
  name1: 'Player 1',
  name2: 'Player 2',
  color1: 'coral',
  color2: 'blue',
  onlineName: '',
  aiLevel: 'easy',
  aiFirst: 'me',
  hasSeenHelp: false,
};

type Listener = (s: Settings) => void;
const listeners = new Set<Listener>();
let current: Settings = storage.get('settings', DEFAULTS);

export const settings = {
  get: () => current,
  set(patch: Partial<Settings>) {
    current = { ...current, ...patch };
    storage.set('settings', current);
    listeners.forEach((l) => l(current));
  },
  reset() {
    current = { ...DEFAULTS };
    storage.set('settings', current);
    listeners.forEach((l) => l(current));
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export interface Record3 {
  w: number;
  l: number;
  d: number;
}
export function aiRecord(): Record<Level, Record3> {
  const blank = { w: 0, l: 0, d: 0 };
  return storage.get('aiRecord', {
    beginner: { ...blank },
    easy: { ...blank },
    medium: { ...blank },
    hard: { ...blank },
    advanced: { ...blank },
  });
}
export function bumpAiRecord(level: Level, key: keyof Record3) {
  const r = aiRecord();
  r[level][key]++;
  storage.set('aiRecord', r);
}

export function sanitizeName(s: string, fallback: string) {
  const t = s.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
  return t || fallback;
}
