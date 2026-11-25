/** Money is stored as integer cents; format only at the API/UI boundary. */
export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
