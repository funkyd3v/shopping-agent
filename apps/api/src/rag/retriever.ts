/** Retrieved policy chunk with cosine distance (lower is better). */
export type RetrievedChunk = {
  id: string;
  source: string;
  title: string;
  section: string;
  content: string;
  distance: number;
};

/** Narrow ports so the RAG pipeline is testable without Chroma or a provider. */
export type PolicyRetriever = {
  retrieve(embedding: number[], topK: number): Promise<RetrievedChunk[]>;
};

export type QueryEmbedder = {
  embed(text: string): Promise<number[]>;
};

export class RetrievalUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetrievalUnavailableError';
  }
}

export class TurnAbortedError extends Error {
  constructor() {
    super('Turn aborted');
    this.name = 'TurnAbortedError';
  }
}

export function isTurnAborted(error: unknown): boolean {
  return error instanceof TurnAbortedError;
}
