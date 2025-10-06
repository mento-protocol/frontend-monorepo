import type { ChainId } from "@/config/chains";
import { getTradablePairForTokens } from "@/features/sdk";
import { TokenSymbol } from "@mento-protocol/mento-sdk";
import { useQuery } from "@tanstack/react-query";
import { useChainId } from "wagmi";
import { useTokenOptions } from "./use-token-options";

export function useTradablePairs(tokenSymbol?: TokenSymbol) {
  const chainId = useChainId() as ChainId;
  const { allTokenOptions, isLoading: isLoadingTokens } = useTokenOptions();

  return useQuery({
    queryKey: ["tradablePairs", chainId, tokenSymbol],
    queryFn: async () => {
      if (!tokenSymbol) return [];

      // Check each token to see if it forms a tradable pair with the given token
      const promises = allTokenOptions.map(async (token) => {
        if (token.symbol === tokenSymbol) return null;

        try {
          const pair = await getTradablePairForTokens(
            chainId,
            tokenSymbol,
            token.symbol as TokenSymbol,
          );

          // If a pair exists, the token is tradable
          if (pair) {
            return token.symbol as TokenSymbol;
          }
        } catch {
          // If no pair exists, the SDK will throw an error
          // We can safely ignore it and continue
        }

        return null;
      });

      const results = await Promise.all(promises);

      // Filter out null values to get only tradable token IDs
      return results.filter((symbol): symbol is TokenSymbol => symbol !== null);
    },
    enabled: !!tokenSymbol && !isLoadingTokens && allTokenOptions.length > 0,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
  });
}
