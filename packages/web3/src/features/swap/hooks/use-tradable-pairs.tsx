import { useQuery } from "@tanstack/react-query";
import { type TokenId } from "@/config/tokens";
import { getTradablePairForTokens } from "@/features/sdk";
import { useTokenOptions } from "./use-token-options";
import { useChainId } from "wagmi";
import type { ChainId } from "@/config/chains";

export function useTradablePairs(tokenId?: TokenId) {
  const chainId = useChainId() as ChainId;
  const { allTokenOptions, isLoading: isLoadingTokens } = useTokenOptions();

  return useQuery({
    queryKey: ["tradablePairs", chainId, tokenId],
    queryFn: async () => {
      if (!tokenId) return [];

      // Check each token to see if it forms a tradable pair with the given token
      const promises = allTokenOptions.map(async (token) => {
        if (token.id === tokenId) return null;

        try {
          const pair = await getTradablePairForTokens(
            chainId,
            tokenId,
            token.id as TokenId,
          );

          // If a pair exists, the token is tradable
          if (pair) {
            return token.id as TokenId;
          }
        } catch {
          // If no pair exists, the SDK will throw an error
          // We can safely ignore it and continue
        }

        return null;
      });

      const results = await Promise.all(promises);

      // Filter out null values to get only tradable token IDs
      return results.filter((id): id is TokenId => id !== null);
    },
    enabled: !!tokenId && !isLoadingTokens && allTokenOptions.length > 0,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
  });
}
