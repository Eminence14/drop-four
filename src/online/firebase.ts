/**
 * Firebase Realtime Database transport. This module (and the Firebase SDK) is
 * only loaded when the player opens Online mode.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import {
  child,
  endAt,
  get,
  getDatabase,
  goOffline,
  goOnline,
  limitToFirst,
  onDisconnect,
  onValue,
  orderByChild,
  query,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set,
  update,
  type Database,
} from 'firebase/database';
import type { RoomData, RoomPlayer, Transport } from './types';
import { firebaseConfig } from './config';

let app: FirebaseApp | null = null;


export async function createFirebaseTransport(): Promise<Transport> {
  app ??= initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const cred = auth.currentUser ? { user: auth.currentUser } : await signInAnonymously(auth);
  const db: Database = getDatabase(app);
  goOnline(db);
  const uid = cred.user.uid;
  const roomRef = (code: string) => ref(db, `rooms/${code}`);
  let offset = 0;
  const offOffset = onValue(ref(db, '.info/serverTimeOffset'), (s) => (offset = Number(s.val()) || 0));

  return {
    kind: 'firebase',
    uid,
    serverNow: () => Date.now() + offset,
    ts: () => serverTimestamp(),
    async create(code, data) {
      try {
        await set(roomRef(code), data);
        return true;
      } catch {
        return false; // rules reject if it already exists
      }
    },
    async get(code) {
      const snap = await get(roomRef(code));
      return snap.exists() ? (snap.val() as RoomData) : null;
    },
    watch(code, cb) {
      return onValue(
        roomRef(code),
        (snap) => cb(snap.exists() ? (snap.val() as RoomData) : null),
        () => cb(null),
      );
    },
    async update(code, patch) {
      await update(roomRef(code), patch);
    },
    async claimP2(code, player: RoomPlayer) {
      try {
        const res = await runTransaction(child(roomRef(code), 'players/p2'), (cur) => (cur ? undefined : player), {
          applyLocally: false,
        });
        if (!res.committed) return (res.snapshot.val() as RoomPlayer | null)?.uid === uid;
        return true;
      } catch {
        // Rules deny if taken. Check whether it's us (rejoin).
        const snap = await get(child(roomRef(code), 'players/p2'));
        return (snap.val() as RoomPlayer | null)?.uid === uid;
      }
    },
    presence(code, cb) {
      const mine = ref(db, `presence/${code}/${uid}`);
      const conn = ref(db, '.info/connected');
      const off1 = onValue(conn, (s) => {
        if (s.val() === true) {
          void onDisconnect(mine)
            .remove()
            .then(() => set(mine, serverTimestamp()));
        }
      });
      const off2 = onValue(ref(db, `presence/${code}`), (s) => cb(Object.keys((s.val() as object) ?? {})));
      return () => {
        off1();
        off2();
        void remove(mine).catch(() => undefined);
      };
    },
    connected(cb) {
      return onValue(ref(db, '.info/connected'), (s) => cb(s.val() === true));
    },
    async cleanup() {
      try {
        const q = query(ref(db, 'rooms'), orderByChild('expiresAt'), endAt(Date.now()), limitToFirst(5));
        const snap = await get(q);
        const jobs: Promise<void>[] = [];
        snap.forEach((c) => {
          jobs.push(remove(c.ref).catch(() => undefined));
        });
        await Promise.all(jobs);
      } catch {
        /* best effort */
      }
    },
    close() {
      offOffset();
      goOffline(db);
    },
  };
}
