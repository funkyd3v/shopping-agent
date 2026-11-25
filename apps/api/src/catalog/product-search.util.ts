/**
 * Product-search helpers (pure so they can be unit-tested without SQLite).
 * FTS5 user input is tokenized and quoted so `OR`/`NEAR`/quotes cannot be
 * injected as query syntax (PLAN §5).
 */

const MAX_FTS_TOKENS = 8;

export function toFtsMatch(query: string | undefined): string | undefined {
  if (!query) return undefined;
  const tokens = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0)
    .slice(0, MAX_FTS_TOKENS);
  if (tokens.length === 0) return undefined;
  return tokens.map((token) => `"${token.replace(/"/g, '""')}"*`).join(' OR ');
}

/** REST/agent prices are dollars; storage is integer cents. */
export function dollarsToCents(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.round(value * 100);
}
