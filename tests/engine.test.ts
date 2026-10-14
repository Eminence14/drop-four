import { describe, expect, it } from 'vitest';
import { analyze, Board, isLegalNext, LINES } from '../src/engine/game';

describe('engine', () => {
  it('has 69 winning windows', () => expect(LINES.length).toBe(69));

  it('drops to the lowest free cell and alternates turns', () => {
    const b = new Board();
    expect(b.turn).toBe(0);
    expect(b.play(3)).toBe(18);
    expect(b.turn).toBe(1);
    expect(b.play(3)).toBe(19);
    expect(b.cells[18]).toBe(0);
    expect(b.cells[19]).toBe(1);
  });

  it('detects horizontal win', () => {
    const { result } = analyze([0, 0, 1, 1, 2, 2, 3]);
    expect(result.winner).toBe(0);
    expect(result.lines).toHaveLength(1);
  });

  it('detects vertical win for second player', () => {
    const { result } = analyze([0, 6, 1, 6, 2, 6, 5, 6]);
    expect(result.winner).toBe(1);
  });

  it('detects both diagonal directions', () => {
    // "/" diagonal for player 0: (0,0)(1,1)(2,2)(3,3)
    expect(analyze([0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3]).result.winner).toBe(0);
    // "\" diagonal for player 0: (6,0)(5,1)(4,2)(3,3)
    expect(analyze([6, 5, 5, 4, 4, 3, 4, 3, 3, 0, 3]).result.winner).toBe(0);
  });

  it('detects edge-of-board wins', () => {
    expect(analyze([3, 0, 4, 0, 5, 0, 6]).result.winner).toBe(0); // right edge
    expect(analyze([6, 0, 6, 0, 6, 0, 5, 0]).result.winner).toBe(1); // left column vertical
  });

  it('reports multiple winning lines from one move', () => {
    const b = new Board();
    const set = (c: number, r: number) => (b.cells[c * 6 + r] = 0);
    [[2, 0], [2, 1], [2, 2], [3, 3], [4, 3], [5, 3], [2, 3]].forEach(([c, r]) => set(c, r));
    expect(b.linesThrough(2 * 6 + 3).length).toBe(2);
  });

  it('detects a draw on a full board', () => {
    // Backtracking search for any full game with no four-in-a-row.
    const b = new Board();
    const dfs = (): boolean => {
      if (b.isFull) return true;
      for (const c of [0, 1, 2, 3, 4, 5, 6]) {
        if (!b.canPlay(c) || b.isWinningMove(c)) continue;
        b.play(c);
        if (dfs()) return true;
        b.undo();
      }
      return false;
    };
    expect(dfs()).toBe(true);
    const { result } = analyze(b.moves);
    expect(result.draw).toBe(true);
    expect(result.over).toBe(true);
    expect(result.winner).toBeNull();
  });

  it('rejects full columns and moves after game over', () => {
    const b = Board.from([0, 0, 0, 0, 0, 0]);
    expect(b.canPlay(0)).toBe(false);
    expect(() => Board.from([0, 0, 0, 0, 0, 0, 0])).toThrow();
    expect(isLegalNext([0, 1, 0, 1, 0, 1, 0], 2)).toBe(false); // already won
    expect(isLegalNext([0, 1], 7)).toBe(false);
    expect(isLegalNext([0, 1], 3)).toBe(true);
  });

  it('undo restores state', () => {
    const b = Board.from([3, 3, 4]);
    b.undo();
    expect(b.moves).toEqual([3, 3]);
    expect(b.heights[4]).toBe(0);
    expect(b.turn).toBe(0);
  });

  it('reconstructs identical state from moves', () => {
    const a = Board.from([3, 2, 4, 4, 1]);
    const c = a.clone();
    expect(Array.from(c.cells)).toEqual(Array.from(a.cells));
  });
});
