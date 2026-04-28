import {
  getCachedTokensSync,
  Token,
  TokenSymbol,
} from "@mento-protocol/mento-sdk";
import { useMemo } from "react";
import { Address } from "viem";
import { useChainId } from "wagmi";

/**
 * Hook to get cached tokens from the Mento SDK for the active chain
 * or an explicitly provided chain.
 */
export function useSDKTokens(chainIdOverride?: number) {
  const walletChainId = useChainId();
  const chainId = chainIdOverride ?? walletChainId;

  return useMemo(() => {
    if (!chainId) return {};

    try {
      // Use SDK's synchronous cached tokens - no async needed!
      const tokens = getCachedTokensSync(chainId);
      const tokenMap: Partial<Record<TokenSymbol, Token>> = {};

      for (const token of tokens) {
        tokenMap[token.symbol as TokenSymbol] = {
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
