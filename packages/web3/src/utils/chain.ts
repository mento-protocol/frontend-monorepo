import { useMemo } from "react";
import { chainIdToChain } from "@/config/chains";
import { useChainId } from "wagmi";

/**
 * Gets the block explorer URL for a given chainId
 * Falls back to Celo mainnet explorer if not found
 */
export function getExplorerUrl(chainId: number): string {
  const chain = chainIdToChain[chainId];
  return chain?.blockExplorers?.default?.url || "https://celoscan.io";
}

/**
 * Hook to get the current chain's explorer URL
 */
export function useExplorerUrl(): string {
  const chainId = useChainId();
  const chain = chainIdToChain[chainId];

  return useMemo(() => {
    return chain?.blockExplorers?.default?.url || "https://celoscan.io";
  }, [chain?.blockExplorers?.default?.url]);
}
