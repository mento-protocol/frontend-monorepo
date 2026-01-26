/**
 * Formats an Ethereum address for display by truncating the middle
 * @param address - The full address to format
 * @param prefixLength - Number of characters to show at start (default: 6, includes "0x")
 * @param suffixLength - Number of characters to show at end (default: 4)
 * @returns Formatted address like "0x1234...5678"
 */
export function formatAddress(
  address: string,
  prefixLength: number = 6,
  suffixLength: number = 4,
): string {
  if (!address || address.length < prefixLength + suffixLength) {
    return address;
  }
  return `${address.slice(0, prefixLength)}...${address.slice(-suffixLength)}`;
}
