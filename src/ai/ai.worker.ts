import { Board } from '../engine/game';
import { chooseMove, hint, type Level } from './search';

export type AIRequest =
  | { id: number; kind: 'move'; moves: number[]; level: Level }
  | { id: number; kind: 'hint'; moves: number[] };

self.onmessage = (e: MessageEvent<AIRequest>) => {
  const req = e.data;
  try {
    const board = Board.from(req.moves);
    const result = req.kind === 'move' ? chooseMove(board, { level: req.level }) : hint(board);
    (self as unknown as Worker).postMessage({ id: req.id, ok: true, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: req.id, ok: false, error: String(err) });
  }
};
