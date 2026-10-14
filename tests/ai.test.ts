import { describe, expect, it } from 'vitest';
import { analyze, Board } from '../src/engine/game';
import { chooseMove, type Level } from '../src/ai/search';

const seeded = (s: number) => () => {
  s = (s * 1664525 + 1013904223) >>> 0;
  return s / 4294967296;
};

function playGame(a: Level, b: Level, seed: number): 0 | 1 | null {
  const rng = seeded(seed);
  const board = new Board();
  // Random opening ply so games differ
  board.play(Math.floor(rng() * 7));
  while (true) {
    const level = board.turn === 0 ? a : b;
    const { col } = chooseMove(board, { level, rng, budgetMs: 150 });
    board.play(col);
    const { result } = analyze(board.moves);
    if (result.over) return result.winner;
  }
}

describe('ai', () => {
  const winNow = [0, 6, 1, 6, 2]; // side 1 to move; side 0 threatens col 3
  it('easy+ blocks an immediate loss', () => {
    for (const level of ['easy', 'medium', 'hard', 'advanced'] as Level[]) {
      const b = Board.from(winNow);
      expect(chooseMove(b, { level, budgetMs: 200 }).col, level).toBe(3);
    }
  });

  it('easy+ takes an immediate win over blocking', () => {
    // side 0 to move, has 3 in col 6 vertical; side 1 threatens row
    const b = Board.from([6, 0, 6, 1, 6, 2]);
    for (const level of ['easy', 'medium', 'hard', 'advanced'] as Level[]) {
      expect(chooseMove(b, { level, budgetMs: 200 }).col, level).toBe(6);
    }
  });

  it('hard and advanced respect their time budgets', () => {
    const b = Board.from([3]);
    const r1 = chooseMove(b, { level: 'hard', budgetMs: 300 });
    expect(r1.ms).toBeLessThan(600);
    const r2 = chooseMove(b, { level: 'advanced', budgetMs: 500 });
    expect(r2.ms).toBeLessThan(900);
    expect(r2.depth).toBeGreaterThan(6);
  });

  it('stronger levels beat weaker ones', () => {
    let hardWins = 0;
    for (let i = 0; i < 6; i++) {
      const hardFirst = i % 2 === 0;
      const w = playGame(hardFirst ? 'hard' : 'easy', hardFirst ? 'easy' : 'hard', i + 1);
      if (w !== null && (w === 0) === hardFirst) hardWins++;
    }
    expect(hardWins).toBeGreaterThanOrEqual(5);

    let medWins = 0;
    for (let i = 0; i < 6; i++) {
      const medFirst = i % 2 === 0;
      const w = playGame(medFirst ? 'medium' : 'beginner', medFirst ? 'beginner' : 'medium', 100 + i);
      if (w !== null && (w === 0) === medFirst) medWins++;
    }
    expect(medWins).toBeGreaterThanOrEqual(5);
  }, 60000);
});
