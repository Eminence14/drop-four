import type { Level, SearchResult } from './search';
import type { AIRequest } from './ai.worker';

type AIRequestBody = AIRequest extends infer R ? (R extends AIRequest ? Omit<R, 'id'> : never) : never;
type Pending = { resolve: (r: SearchResult) => void; reject: (e: Error) => void };

/** Thin promise wrapper around the AI Web Worker. Old requests are dropped when cancelled. */
class AIClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();

  private get w(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => {
        const { id, ok, result, error } = e.data;
        const p = this.pending.get(id);
        if (!p) return;
        this.pending.delete(id);
        if (ok) p.resolve(result);
        else p.reject(new Error(error));
      };
    }
    return this.worker;
  }

  private send(req: AIRequestBody): Promise<SearchResult> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.w.postMessage({ ...req, id });
    });
  }

  /** Starts the worker early so the first AI reply isn't delayed by worker start-up. */
  warm() {
    void this.w;
  }

  move(moves: number[], level: Level) {
    return this.send({ kind: 'move', moves, level });
  }

  hint(moves: number[]) {
    return this.send({ kind: 'hint', moves });
  }

  /** Abandons in-flight work (e.g. on undo or leaving the screen). */
  cancel() {
    for (const p of this.pending.values()) p.reject(new Error('cancelled'));
    this.pending.clear();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

export const ai = new AIClient();
