/**
 * Four-in-a-row AI: heuristic levels + iterative-deepening negamax with
 * alpha-beta pruning, Zobrist-hashed transposition table and threat-aware
 * evaluation. Runs synchronously; call it from a Web Worker.
 */
import { Board, CELLS, CENTER_ORDER, COLS, LINES, ROWS, rowOf } from '../engine/game';

export type Level = 'beginner' | 'easy' | 'medium' | 'hard' | 'advanced';
export const LEVELS: Level[] = ['beginner', 'easy', 'medium', 'hard', 'advanced'];

export interface LevelSpec {
  label: string;
  blurb: string;
}
export const LEVEL_INFO: Record<Level, LevelSpec> = {
  beginner: { label: 'Beginner', blurb: 'Still learning the rules' },
  easy: { label: 'Easy', blurb: 'Wins and blocks the obvious' },
  medium: { label: 'Medium', blurb: 'Thinks a few moves ahead' },
  hard: { label: 'Hard', blurb: 'Sets traps, rarely slips' },
  advanced: { label: 'Advanced', blurb: 'Deep search. Good luck.' },
};

export interface SearchResult {
  col: number;
  /** Score from the mover's perspective (positive = good). */
  score: number;
  depth: number;
  nodes: number;
  ms: number;
  /** Per-column scores at the final completed depth (null = illegal/unsearched). */
  columnScores?: (number | null)[];
}

const WIN = 1_000_000;
const isMate = (s: number) => Math.abs(s) > WIN - 100;

/* ---------------- Zobrist ---------------- */
// Two 26-bit halves combined into a safe-integer key (52 bits).
const Z1 = new Int32Array(CELLS * 2);
const Z2 = new Int32Array(CELLS * 2);
{
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) & 0x3ffffff;
  };
  for (let i = 0; i < CELLS * 2; i++) {
    Z1[i] = rnd();
    Z2[i] = rnd();
  }
}

class Abort extends Error {}

const EXACT = 0,
  LOWER = 1,
  UPPER = 2;
interface TTEntry {
  d: number;
  s: number;
  f: number;
  m: number;
}

class Searcher {
  b: Board;
  h1 = 0;
  h2 = 0;
  nodes = 0;
  deadline = Infinity;
  tt = new Map<number, TTEntry>();

  constructor(board: Board) {
    this.b = board.clone();
    for (let i = 0; i < CELLS; i++) {
      const v = this.b.cells[i];
      if (v >= 0) {
        this.h1 ^= Z1[i * 2 + v];
        this.h2 ^= Z2[i * 2 + v];
      }
    }
  }

  key() {
    return this.h1 * 67108864 + this.h2;
  }

  play(c: number) {
    const side = this.b.turn;
    const cell = this.b.play(c);
    this.h1 ^= Z1[cell * 2 + side];
    this.h2 ^= Z2[cell * 2 + side];
  }

  undo() {
    const c = this.b.undo()!;
    const cell = c * ROWS + this.b.heights[c];
    const side = this.b.turn;
    this.h1 ^= Z1[cell * 2 + side];
    this.h2 ^= Z2[cell * 2 + side];
  }

  /** Static evaluation from the side-to-move's perspective. */
  evaluate(): number {
    const cells = this.b.cells;
    const heights = this.b.heights;
    const me = this.b.turn;
    let score = 0;
    for (let i = 0; i < LINES.length; i++) {
      const line = LINES[i];
      let a = 0,
        o = 0,
        empty = -1;
      for (let k = 0; k < 4; k++) {
        const v = cells[line[k]];
        if (v === me) a++;
        else if (v >= 0) o++;
        else empty = line[k];
      }
      if (a && o) continue;
      const n = a || o;
      const sign = a ? 1 : -1;
      if (n === 3) {
        // A three with one gap. Threats you can't be forced to cash early are worth more,
        // and threats on the "right" row parity are worth more still (zugzwang theory:
        // first player wants odd rows (r=0,2,4), second wants even rows (r=1,3,5)).
        const owner = a ? me : 1 - me;
        const r = rowOf(empty);
        const c = (empty / ROWS) | 0;
        const playable = heights[c] === r;
        let v = playable ? 60 : 90;
        if ((owner === 0 && r % 2 === 0) || (owner === 1 && r % 2 === 1)) v += 40;
        score += sign * v;
      } else if (n === 2) score += sign * 6;
      else if (n === 1) score += sign * 1;
    }
    // Centre column control.
    for (let r = 0; r < ROWS; r++) {
      const v = cells[3 * ROWS + r];
      if (v === me) score += 4;
      else if (v >= 0) score -= 4;
    }
    return score;
  }

  negamax(depth: number, alpha: number, beta: number, ply: number): number {
    if ((++this.nodes & 4095) === 0 && performance.now() > this.deadline) throw new Abort();
    const b = this.b;

    // Immediate win available?
    for (let c = 0; c < COLS; c++) if (b.isWinningMove(c)) return WIN - ply - 1;
    if (b.ply >= CELLS - 1) return 0; // last move can't win (checked) → draw

    // Forced replies: opponent threats that must be blocked.
    const opp = (1 - b.turn) as 0 | 1;
    let forced = -1;
    let forcedCount = 0;
    for (let c = 0; c < COLS; c++)
      if (b.heights[c] < ROWS && b.isWinningMove(c, opp)) {
        forced = c;
        forcedCount++;
      }
    if (forcedCount > 1) return -(WIN - ply - 2); // can't block two threats

    if (depth <= 0) return this.evaluate();

    const alpha0 = alpha;
    const key = this.key();
    const e = this.tt.get(key);
    let ttMove = -1;
    if (e) {
      ttMove = e.m;
      if (e.d >= depth) {
        if (e.f === EXACT) return e.s;
        if (e.f === LOWER) alpha = Math.max(alpha, e.s);
        else if (e.f === UPPER) beta = Math.min(beta, e.s);
        if (alpha >= beta) return e.s;
      }
    }

    let moves: number[];
    if (forced >= 0) moves = [forced];
    else {
      moves = [];
      if (ttMove >= 0 && b.heights[ttMove] < ROWS) moves.push(ttMove);
      for (const c of CENTER_ORDER) if (c !== ttMove && b.heights[c] < ROWS) moves.push(c);
      // Moves that hand the opponent a win directly above go last.
      moves.sort((x, y) => this.givesWinAbove(x) - this.givesWinAbove(y));
    }

    let best = -Infinity;
    let bestMove = moves[0];
    for (const c of moves) {
      this.play(c);
      const s = -this.negamax(depth - 1, -beta, -alpha, ply + 1);
      this.undo();
      if (s > best) {
        best = s;
        bestMove = c;
      }
      if (s > alpha) alpha = s;
      if (alpha >= beta) break;
    }

    if (this.tt.size > 2_000_000) this.tt.clear();
    this.tt.set(key, {
      d: depth,
      s: best,
      m: bestMove,
      f: best <= alpha0 ? UPPER : best >= beta ? LOWER : EXACT,
    });
    return best;
  }

  /** 1 if playing c lets the opponent win by playing on top of it. */
  givesWinAbove(c: number): number {
    const b = this.b;
    if (b.heights[c] >= ROWS - 1) return 0;
    this.b.play(c);
    const bad = b.isWinningMove(c) ? 1 : 0;
    this.b.undo();
    return bad;
  }

  /** Scores each root move at fixed depth (full window). */
  rootScores(depth: number): (number | null)[] {
    const out: (number | null)[] = Array(COLS).fill(null);
    for (const c of CENTER_ORDER) {
      if (this.b.heights[c] >= ROWS) continue;
      if (this.b.isWinningMove(c)) {
        out[c] = WIN;
        continue;
      }
      this.play(c);
      out[c] = -this.negamax(depth - 1, -WIN - 1, WIN + 1, 1);
      this.undo();
    }
    return out;
  }
}

/* ---------------- Public API ---------------- */

type Rng = () => number;

function centerBiasedRandom(b: Board, rng: Rng, avoid: number[] = []): number {
  const legal = b.legalMoves();
  const pool = legal.filter((c) => !avoid.includes(c));
  const choices = pool.length ? pool : legal;
  const weights = choices.map((c) => 4 - Math.abs(3 - c)); // 4,3,2,1
  const total = weights.reduce((a, w) => a + w, 0);
  let x = rng() * total;
  for (let i = 0; i < choices.length; i++) {
    x -= weights[i];
    if (x <= 0) return choices[i];
  }
  return choices[choices.length - 1];
}

function immediate(b: Board, side: 0 | 1): number[] {
  const out: number[] = [];
  for (const c of CENTER_ORDER) if (b.isWinningMove(c, side)) out.push(c);
  return out;
}

/** Columns where playing lets the opponent win immediately on top. */
function poisoned(b: Board): number[] {
  const out: number[] = [];
  const copy = b.clone();
  for (const c of copy.legalMoves()) {
    if (copy.heights[c] >= ROWS - 1) continue;
    copy.play(c);
    if (copy.isWinningMove(c)) out.push(c);
    copy.undo();
  }
  return out;
}

export interface SearchOptions {
  level: Level;
  /** Override time budget in ms (hard/advanced/hint). */
  budgetMs?: number;
  rng?: Rng;
}

export function iterativeDeepening(board: Board, maxDepth: number, budgetMs: number): SearchResult {
  const t0 = performance.now();
  const s = new Searcher(board);
  s.deadline = t0 + budgetMs;
  const legal = board.legalMoves();
  let best: SearchResult = { col: legal[0], score: 0, depth: 0, nodes: 0, ms: 0 };
  const remaining = CELLS - board.ply;
  const cap = Math.min(maxDepth, remaining);
  for (let d = 1; d <= cap; d++) {
    try {
      const scores = s.rootScores(d);
      let bc = legal[0];
      let bs = -Infinity;
      for (const c of CENTER_ORDER) {
        const v = scores[c];
        if (v !== null && v > bs) {
          bs = v;
          bc = c;
        }
      }
      best = { col: bc, score: bs, depth: d, nodes: s.nodes, ms: performance.now() - t0, columnScores: scores };
      if (isMate(bs)) break; // proven result
      // If every move but one is proven lost, stop.
    } catch (e) {
      if (e instanceof Abort) break;
      throw e;
    }
  }
  best.ms = performance.now() - t0;
  best.nodes = s.nodes;
  return best;
}

export function chooseMove(board: Board, opts: SearchOptions): SearchResult {
  const rng = opts.rng ?? Math.random;
  const t0 = performance.now();
  const me = board.turn;
  const them = (1 - me) as 0 | 1;
  const done = (col: number, score = 0, depth = 0): SearchResult => ({
    col,
    score,
    depth,
    nodes: 0,
    ms: performance.now() - t0,
  });

  switch (opts.level) {
    case 'beginner': {
      const wins = immediate(board, me);
      if (wins.length && rng() < 0.5) return done(wins[0]);
      const blocks = immediate(board, them);
      if (blocks.length && rng() < 0.3) return done(blocks[0]);
      return done(centerBiasedRandom(board, rng));
    }
    case 'easy': {
      const wins = immediate(board, me);
      if (wins.length) return done(wins[0]);
      const blocks = immediate(board, them);
      if (blocks.length) return done(blocks[0]);
      const avoid = rng() < 0.6 ? poisoned(board) : [];
      return done(centerBiasedRandom(board, rng, avoid));
    }
    case 'medium': {
      const s = new Searcher(board);
      const scores = s.rootScores(5);
      let bestScore = -Infinity;
      for (const v of scores) if (v !== null && v > bestScore) bestScore = v;
      // Play any move within a tolerance of the best (unless results are proven).
      const tol = isMate(bestScore) ? 0 : 45;
      const near = scores
        .map((v, c) => ({ v, c }))
        .filter((x) => x.v !== null && (x.v as number) >= bestScore - tol)
        .map((x) => x.c);
      const col = near[Math.floor(rng() * near.length)];
      return { ...done(col, bestScore, 5), nodes: s.nodes, columnScores: scores };
    }
    case 'hard':
      return iterativeDeepening(board, 10, opts.budgetMs ?? 900);
    case 'advanced':
      return iterativeDeepening(board, 42, opts.budgetMs ?? 2500);
  }
}

/** A suggested move for the human (used by the Hint button). */
export function hint(board: Board, budgetMs = 700): SearchResult {
  return iterativeDeepening(board, 14, budgetMs);
}

export function describeScore(score: number, plyNow: number): string {
  if (score >= WIN - 100) {
    const plies = WIN - score;
    const moves = Math.ceil(plies / 2);
    return `Winning in ${moves} move${moves === 1 ? '' : 's'}`;
  }
  if (score <= -(WIN - 100)) return 'Losing against best play';
  void plyNow;
  if (score > 150) return 'Clear advantage';
  if (score > 40) return 'Slight advantage';
  if (score < -150) return 'Under pressure';
  if (score < -40) return 'Slightly worse';
  return 'Balanced';
}
