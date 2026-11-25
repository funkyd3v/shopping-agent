/** Cross-component signal so the header badge refreshes after cart mutations. */
export const CART_UPDATED_EVENT = 'shopping-agent:cart-updated';

export function notifyCartUpdated(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CART_UPDATED_EVENT));
}
