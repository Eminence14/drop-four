/**
 * Security-rules tests. Run with the Firebase emulator:
 *   npm run test:rules
 * (needs Java and `firebase-tools`; downloads the emulator on first run)
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { ref, remove, set, update } from 'firebase/database';

let env: RulesTestEnvironment;
const CODE = 'K7QM';
const now = () => Date.now();
const room = (over: Record<string, unknown> = {}) => ({
  createdAt: now(),
  expiresAt: now() + 3_600_000,
  status: 'playing',
  players: { p1: { uid: 'alice', name: 'Alice', color: 'coral' }, p2: { uid: 'bob', name: 'Bob', color: 'blue' } },
  firstPlayer: 'p1',
  gameNumber: 1,
  score: { p1: 0, p2: 0, draws: 0 },
  ...over,
});
const db = (uid: string | null) => (uid ? env.authenticatedContext(uid).database() : env.unauthenticatedContext().database());
const seed = (data: unknown) => env.withSecurityRulesDisabled((c) => set(ref(c.database(), `rooms/${CODE}`), data));

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-dropfour',
    database: { rules: readFileSync('database.rules.json', 'utf8'), host: '127.0.0.1', port: 9000 },
  });
});
afterAll(() => env.cleanup());
beforeEach(() => env.clearDatabase());

describe('room creation', () => {
  it('lets a signed-in user create a room as p1', async () => {
    const r = room({ status: 'waiting', players: { p1: { uid: 'alice', name: 'Alice', color: 'coral' } } });
    await assertSucceeds(set(ref(db('alice'), `rooms/${CODE}`), r));
  });
  it('rejects anonymous, overwriting, impersonation and bad codes', async () => {
    const r = room({ status: 'waiting', players: { p1: { uid: 'alice', name: 'Alice', color: 'coral' } } });
    await assertFails(set(ref(db(null), `rooms/${CODE}`), r));
    await assertFails(set(ref(db('mallory'), `rooms/${CODE}`), r));
    await assertFails(set(ref(db('alice'), `rooms/O0IL`), r));
    await seed(r);
    await assertFails(set(ref(db('alice'), `rooms/${CODE}`), r));
  });
});

describe('joining', () => {
  beforeEach(() => seed(room({ status: 'waiting', players: { p1: { uid: 'alice', name: 'Alice', color: 'coral' } } })));
  it('lets one other user claim p2', async () => {
    await assertSucceeds(set(ref(db('bob'), `rooms/${CODE}/players/p2`), { uid: 'bob', name: 'Bob', color: 'blue' }));
    await assertFails(set(ref(db('carol'), `rooms/${CODE}/players/p2`), { uid: 'carol', name: 'C', color: 'mint' }));
  });
  it('rejects p1 claiming p2 or claiming for someone else', async () => {
    await assertFails(set(ref(db('alice'), `rooms/${CODE}/players/p2`), { uid: 'alice', name: 'A', color: 'blue' }));
    await assertFails(set(ref(db('bob'), `rooms/${CODE}/players/p2`), { uid: 'carol', name: 'C', color: 'blue' }));
  });
});

describe('moves', () => {
  beforeEach(() => seed(room()));
  it('accepts a correct append by the player to move', async () => {
    await assertSucceeds(update(ref(db('alice'), `rooms/${CODE}`), { moves: '3' }));
    await assertSucceeds(update(ref(db('bob'), `rooms/${CODE}`), { moves: '33' }));
  });
  it('rejects out-of-turn moves', async () => {
    await assertFails(update(ref(db('bob'), `rooms/${CODE}`), { moves: '3' }));
  });
  it('rejects non-players, gaps, overwrites and bad columns', async () => {
    await assertFails(update(ref(db('carol'), `rooms/${CODE}`), { moves: '3' }));
    await assertFails(update(ref(db('alice'), `rooms/${CODE}`), { moves: '33' }));
    await assertFails(update(ref(db('alice'), `rooms/${CODE}`), { moves: '7' }));
    await seed(room({ moves: '34' }));
    await assertFails(update(ref(db('alice'), `rooms/${CODE}`), { moves: '345'.replace('34', '44') }));
    await assertFails(remove(ref(db('alice'), `rooms/${CODE}/moves`)));
  });
  it('respects firstPlayer = p2', async () => {
    await seed(room({ firstPlayer: 'p2' }));
    await assertFails(update(ref(db('alice'), `rooms/${CODE}`), { moves: '3' }));
    await assertSucceeds(update(ref(db('bob'), `rooms/${CODE}`), { moves: '3' }));
  });
  it('rejects moves before the game starts', async () => {
    await seed(room({ status: 'waiting' }));
    await assertFails(update(ref(db('alice'), `rooms/${CODE}`), { moves: '3' }));
  });
});

describe('rematch', () => {
  const reset = { moves: null, gameNumber: 2, firstPlayer: 'p2', score: { p1: 1, p2: 0, draws: 0 }, rematch: null };
  it('only resets when both players asked', async () => {
    await seed(room({ moves: '0101010', rematch: { p1: true } }));
    await assertFails(update(ref(db('alice'), `rooms/${CODE}`), reset));
    await assertSucceeds(update(ref(db('bob'), `rooms/${CODE}/rematch`), { p2: true }));
    await assertSucceeds(update(ref(db('alice'), `rooms/${CODE}`), reset));
    // second identical reset (race) is refused
    await assertFails(update(ref(db('bob'), `rooms/${CODE}`), reset));
  });
  it('players can only set their own rematch flag', async () => {
    await seed(room());
    await assertFails(set(ref(db('alice'), `rooms/${CODE}/rematch/p2`), true));
  });
});

describe('cleanup', () => {
  it('allows deleting only expired rooms', async () => {
    await seed(room());
    await assertFails(remove(ref(db('carol'), `rooms/${CODE}`)));
    await seed(room({ expiresAt: now() - 1000 }));
    await assertSucceeds(remove(ref(db('carol'), `rooms/${CODE}`)));
  });
});
