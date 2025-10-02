import { useMemo } from "react";
import { useChainId } from "wagmi";
import { Address } from "viem";
import { getCachedTokensSync } from "@mento-protocol/mento-sdk";

/**
 * Hook to get cached tokens from the Mento SDK for the current chain
 * Now synchronous - uses SDK's built-in token cache for instant access
 * No async loading needed!
 */
export function useSDKTokens() {
  const chainId = useChainId();

  return useMemo(() => {
    if (!chainId) return {};

    try {
      // Use SDK's synchronous cached tokens - no async needed!
      const tokens = getCachedTokensSync(chainId);

      const tokenMap: Record<
        string,
        {
          symbol: string;
          address: Address;
          name: string;
          decimals: number;
        }
      > = {};

      for (const token of tokens) {
        tokenMap[token.symbol] = {
          symbol: token.symbol,
          address: token.address as Address,
          name: token.name,
          decimals: token.decimals,
        };
      }

      return tokenMap;
    } catch (error) {
      console.error(
        `❌ Failed to load cached tokens for chain ${chainId}:`,
        error,
      );
      return {};
    }
  }, [chainId]);
}
