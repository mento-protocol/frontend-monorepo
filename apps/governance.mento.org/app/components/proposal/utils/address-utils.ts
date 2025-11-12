/**
 * Formats an address for display by truncating the middle
 */
export function formatAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Normalizes an address to lowercase for comparison
 */
export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}
