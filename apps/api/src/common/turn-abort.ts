/**
 * Cooperative abort for buffered chat turns (PLAN §11.4). A client disconnect or
 * the Stop button aborts the request signal; pipeline stages translate that into
 * this error so controllers can stop without persisting a partial assistant row.
 */
export class TurnAbortedError extends Error {
  constructor() {
    super('Turn aborted');
    this.name = 'TurnAbortedError';
  }
}

export function isTurnAborted(error: unknown): boolean {
  return error instanceof TurnAbortedError;
}
