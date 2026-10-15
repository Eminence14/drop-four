/**
 * Same-browser transport (two tabs) for development and automated tests.
 * Enabled with ?transport=local. Mirrors the Firebase transport's behaviour.
 */
import type { RoomData, RoomPlayer, Transport } from './types';

const K = (code: string) => `df.localroom.${code}`;
const P = (code: string) => `df.localpres.${code}`;

function read(code: string): RoomData | null {
  const raw = localStorage.getItem(K(code));
  return raw ? (JSON.parse(raw) as RoomData) : null;
}
const bus = new BroadcastChannel('df-local-transport');
const localListeners = new Set<() => void>();
const notify = () => {
  bus.postMessage('x');
  localListeners.forEach((l) => l());
};
bus.onmessage = () => localListeners.forEach((l) => l());
// Cross-tab localStorage can lag the broadcast; the storage event fires once it has synced.
addEventListener('storage', () => localListeners.forEach((l) => l()));

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('/');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    o[parts[i]] ??= {};
    o = o[parts[i]] as Record<string, unknown>;
  }
  if (value === null) delete o[parts[parts.length - 1]];
  else o[parts[parts.length - 1]] = value;
}

export function createLocalTransport(): Transport {
  let uid = sessionStorage.getItem('df.localuid');
  if (!uid) {
    uid = 'local-' + Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem('df.localuid', uid);
  }
  const me = uid;
  return {
    kind: 'local',
    uid: me,
    serverNow: () => Date.now(),
    ts: () => Date.now(),
    async create(code, data) {
      if (read(code)) return false;
      localStorage.setItem(K(code), JSON.stringify(data));
      notify();
      return true;
    },
    async get(code) {
      return read(code);
    },
    watch(code, cb) {
      let last = '';
      const l = () => {
        const raw = localStorage.getItem(K(code)) ?? '';
        if (raw !== last) {
          last = raw;
          cb(raw ? JSON.parse(raw) : null);
        }
      };
      localListeners.add(l);
      queueMicrotask(l);
      return () => localListeners.delete(l);
    },
    async update(code, patch) {
      const r = read(code) as unknown as Record<string, unknown> | null;
      if (!r) throw new Error('missing');
      // Mirror the essential rule: moves are append-only (or reset with a new game).
      if ('moves' in patch) {
        const cur = (r.moves as string) ?? '';
        const next = patch.moves as string | null;
        const ok = typeof next === 'string' && next.startsWith(cur) && next.length === cur.length + 1;
        const reset = next === null && patch.gameNumber === (r.gameNumber as number) + 1;
        if (!ok && !reset) throw new Error('PERMISSION_DENIED');
      }
      for (const [k, v] of Object.entries(patch)) setPath(r, k, v);
      localStorage.setItem(K(code), JSON.stringify(r));
      notify();
    },
    async claimP2(code, player: RoomPlayer) {
      const r = read(code);
      if (!r) return false;
      if (r.players.p2) return r.players.p2.uid === me;
      r.players.p2 = player;
      localStorage.setItem(K(code), JSON.stringify(r));
      notify();
      return true;
    },
    presence(code, cb) {
      const beat = () => {
        const p = JSON.parse(localStorage.getItem(P(code)) ?? '{}');
        p[me] = Date.now();
        localStorage.setItem(P(code), JSON.stringify(p));
        const now = Date.now();
        cb(Object.keys(p).filter((u) => now - p[u] < 3500));
      };
      beat();
      const t = setInterval(beat, 1000);
      return () => {
        clearInterval(t);
        const p = JSON.parse(localStorage.getItem(P(code)) ?? '{}');
        delete p[me];
        localStorage.setItem(P(code), JSON.stringify(p));
      };
    },
    connected(cb) {
      const f = () => cb(navigator.onLine);
      f();
      addEventListener('online', f);
      addEventListener('offline', f);
      return () => {
        removeEventListener('online', f);
        removeEventListener('offline', f);
      };
    },
    async cleanup() {},
    close() {},
  };
}
