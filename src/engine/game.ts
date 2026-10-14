/**
 * Pure four-in-a-row engine. No DOM, no network.
 *
 * Coordinates: column c (0..6, left→right), row r (0..5, bottom→top).
 * Cell index = c * ROWS + r.
 * Players are 0 and 1, where 0 is whoever moved first *in this game*.
 * A game is fully described by its ordered list of column indices.
 */

export const COLS = 7;
export const ROWS = 6;
export const CELLS = COLS * ROWS;
export const CENTER_ORDER = [3, 2, 4, 1, 5, 0, 6] as const;

export type Side = 0 | 1;
export type Line = readonly [number, number, number, number];

export const cellOf = (c: number, r: number) => c * ROWS + r;
export const colOf = (cell: number) => Math.floor(cell / ROWS);
export const rowOf = (cell: number) => cell % ROWS;

/** All 69 possible four-cell windows. */
export const LINES: readonly Line[] = (() => {
  const out: Line[] = [];
  const dirs = [
    [1, 0], // horizontal
    [0, 1], // vertical
    [1, 1], // diagonal /
    [1, -1], // diagonal \
  ];
  for (let c = 0; c < COLS; c++)
    for (let r = 0; r < ROWS; r++)
      for (const [dc, dr] of dirs) {
        const ec = c + 3 * dc;
        const er = r + 3 * dr;
        if (ec < 0 || ec >= COLS || er < 0 || er >= ROWS) continue;
        out.push([
          cellOf(c, r),
          cellOf(c + dc, r + dr),
          cellOf(c + 2 * dc, r + 2 * dr),
          cellOf(ec, er),
        ]);
      }
  return out;
})();

/** For each cell, the indices (into LINES) of the windows containing it. */
export const CELL_LINES: readonly (readonly number[])[] = (() => {
  const out: number[][] = Array.from({ length: CELLS }, () => []);
  LINES.forEach((line, i) => line.forEach((cell) => out[cell].push(i)));
  return out;
})();

export class Board {
  /** -1 empty, 0 / 1 = side */
  readonly cells = new Int8Array(CELLS).fill(-1);
  readonly heights = new Int8Array(COLS);
  readonly moves: number[] = [];

  static from(moves: readonly number[]): Board {
    const b = new Board();
    for (const m of moves) {
      if (!b.canPlay(m)) throw new Error(`Illegal move ${m} at ply ${b.moves.length}`);
      b.play(m);
    }
    return b;
  }

  clone(): Board {
    return Board.from(this.moves);
  }

  get ply() {
    return this.moves.length;
  }

  /** Side to move. */
  get turn(): Side {
    return (this.moves.length & 1) as Side;
  }

  get isFull() {
    return this.moves.length >= CELLS;
  }

  canPlay(c: number): boolean {
    return Number.isInteger(c) && c >= 0 && c < COLS && this.heights[c] < ROWS;
  }

  legalMoves(): number[] {
    const out: number[] = [];
    for (const c of CENTER_ORDER) if (this.heights[c] < ROWS) out.push(c);
    return out;
  }

  /** Plays column c for the side to move. Returns the cell filled. */
  play(c: number): number {
    const cell = c * ROWS + this.heights[c];
    this.cells[cell] = this.moves.length & 1;
    this.heights[c]++;
    this.moves.push(c);
    return cell;
  }

  undo(): number | undefined {
    const c = this.moves.pop();
    if (c === undefined) return undefined;
    this.heights[c]--;
    this.cells[c * ROWS + this.heights[c]] = -1;
    return c;
  }

  /** Would the side to move win immediately by playing c? */
  isWinningMove(c: number, side: Side = this.turn): boolean {
    if (this.heights[c] >= ROWS) return false;
    const cell = c * ROWS + this.heights[c];
    const lines = CELL_LINES[cell];
    for (let i = 0; i < lines.length; i++) {
      const line = LINES[lines[i]];
      let ok = true;
      for (let k = 0; k < 4; k++) {
        const x = line[k];
        if (x !== cell && this.cells[x] !== side) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
    return false;
  }

  /** Every complete line that passes through `cell` for the owner of that cell. */
  linesThrough(cell: number): Line[] {
    const side = this.cells[cell];
    if (side < 0) return [];
    return CELL_LINES[cell]
      .map((i) => LINES[i])
      .filter((line) => line.every((x) => this.cells[x] === side));
  }
}

export interface GameResult {
  winner: Side | null;
  draw: boolean;
  over: boolean;
  /** Winning lines (cell indices); may contain more than one line. */
  lines: Line[];
}

/** Derives the result of a move list. Stops checking at the first win. */
export function analyze(moves: readonly number[]): { board: Board; result: GameResult } {
  const board = new Board();
  for (const m of moves) {
    if (!board.canPlay(m)) throw new Error(`Illegal move ${m}`);
    const cell = board.play(m);
    const lines = board.linesThrough(cell);
    if (lines.length) {
      return {
        board,
        result: { winner: board.cells[cell] as Side, draw: false, over: true, lines },
      };
    }
  }
  const draw = board.isFull;
  return { board, result: { winner: null, draw, over: draw, lines: [] } };
}

/** True if appending `col` to `moves` is legal (game not over, column not full). */
export function isLegalNext(moves: readonly number[], col: number): boolean {
  try {
    const { board, result } = analyze(moves);
    return !result.over && board.canPlay(col);
  } catch {
    return false;
  }
}
