import { useCurrentChain } from "@repo/web3";
import { useMemo } from "react";

/**
 * Formats an address for display by truncating the middle
 */
export function formatAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Hook to get the current chain's explorer URL
 */
export function useExplorerUrl(): string {
  const currentChain = useCurrentChain();

  return useMemo(() => {
    return currentChain.blockExplorers?.default?.url || "https://celoscan.io";
  }, [currentChain.blockExplorers?.default?.url]);
}

/**
 * Normalizes an address to lowercase for comparison
 */
export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}
