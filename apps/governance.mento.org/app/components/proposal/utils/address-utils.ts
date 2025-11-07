import { useExplorerUrl as useExplorerUrlFromWeb3 } from "@repo/web3";

/**
 * Formats an address for display by truncating the middle
 */
export function formatAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Hook to get the current chain's explorer URL
 * Re-exported from @repo/web3 for backwards compatibility
 */
export const useExplorerUrl = useExplorerUrlFromWeb3;

/**
 * Normalizes an address to lowercase for comparison
 */
export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}
