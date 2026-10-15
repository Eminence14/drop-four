import type { TimerSpec } from '../ui/timer';

export type SeatId = 'p1' | 'p2';
export interface RoomPlayer {
  uid: string;
  name: string;
  color: string;
  avatar?: string;
}
export interface Reaction {
  e: string;
  at: number;
}
export interface RoomData {
  createdAt: number;
  expiresAt: number;
  status: 'waiting' | 'playing';
  players: { p1: RoomPlayer; p2?: RoomPlayer | null };
  /** Current game's moves as a string of column digits, e.g. "3342". Absent = no moves yet. */
  moves?: string | null;
  firstPlayer: SeatId;
  gameNumber: number;
  score: { p1: number; p2: number; draws: number };
  rematch?: Partial<Record<SeatId, boolean>> | null;
  reactions?: Partial<Record<SeatId, Reaction>> | null;
  left?: Partial<Record<SeatId, boolean>> | null;
  /** Timed matches: fixed at room creation. */
  timer?: TimerSpec | null;
  /** Server time (ms) when the current turn's clock started (absent until the mover sees the board). */
  turnAt?: number | null;
  /** Bank mode: remaining ms per player. */
  bank?: Record<SeatId, number> | null;
  strikes?: Partial<Record<SeatId, number>> | null;
  /** Seat that lost on time this game. */
  forfeit?: SeatId | null;
}

/** Everything the online UI needs from a realtime backend. */
export interface Transport {
  readonly kind: 'firebase' | 'local';
  uid: string;
  /** Best estimate of the server's clock (ms since epoch). */
  serverNow(): number;
  /** Placeholder the backend replaces with its own clock when written. */
  ts(): unknown;
  create(code: string, data: RoomData): Promise<boolean>;
  get(code: string): Promise<RoomData | null>;
  watch(code: string, cb: (room: RoomData | null) => void): () => void;
  /** Multi-path update relative to the room, e.g. { moves: '334', expiresAt: n }. */
  update(code: string, patch: Record<string, unknown>): Promise<void>;
  /** Atomically claims seat p2 if free. */
  claimP2(code: string, player: RoomPlayer): Promise<boolean>;
  /** Registers own presence in the room and reports who is present. */
  presence(code: string, cb: (uids: string[]) => void): () => void;
  /** Reports connectivity to the backend. */
  connected(cb: (online: boolean) => void): () => void;
  /** Deletes a few expired rooms (best effort). */
  cleanup(): Promise<void>;
  close(): void;
}

export const ROOM_TTL = 24 * 60 * 60 * 1000;
/** Unambiguous alphabet: no 0/O, 1/I/L. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function randomCode(): string {
  const a = new Uint32Array(4);
  crypto.getRandomValues(a);
  return Array.from(a, (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
}
export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .split('')
    .filter((ch) => CODE_ALPHABET.includes(ch))
    .join('')
    .slice(0, 4);
}
