import { useQuery } from "@tanstack/react-query";
import { getMentoSdk } from "@/features/sdk";
import { TokenId, getTokenAddress } from "@/config/tokens";
import { getTradablePairForTokens } from "@/features/sdk";
import { getTokenByAddress } from "@/config/tokens";

export function useTradingLimits(
  fromTokenId: string,
  toTokenId: string,
  chainId: number,
) {
  return useQuery({
    queryKey: ["trading-limits", fromTokenId, toTokenId, chainId],
    queryFn: async () => {
      if (!fromTokenId || !toTokenId) return null;

      const mento = await getMentoSdk(chainId);
      const tradablePair = await getTradablePairForTokens(
        chainId,
        fromTokenId as TokenId,
        toTokenId as TokenId,
      );

      if (
        !tradablePair ||
        !tradablePair.path ||
        tradablePair.path.length === 0
      ) {
        return null;
      }

      const exchangeId = tradablePair.path[0].id;
      const tradingLimits = await mento.getTradingLimits(exchangeId);
      const filteredTradingLimits = tradingLimits.filter(
        (limit) =>
          limit.asset === getTokenAddress(fromTokenId as TokenId, chainId),
      );
      const limitCfg = await mento.getTradingLimitConfig(exchangeId);

      const filteredLimitCfg = limitCfg.filter(
        (limit) =>
          limit.asset === getTokenAddress(fromTokenId as TokenId, chainId),
      );
      // Sort limits by 'until' timestamp in ascending order
      const sortedLimits = filteredTradingLimits.sort(
        (a, b) => a.until - b.until,
      );

      const limitAsset = filteredTradingLimits[0]?.asset;
      const tokenToCheck = limitAsset
        ? getTokenByAddress(limitAsset as TokenId).symbol
        : null;

      // Extract L0, L1, and LG limits based on timestamp ranking
      const L0 = sortedLimits[0] || null; // Soonest timestamp (e.g., 5 minutes)
      const L1 = sortedLimits[1] || null; // Middle timestamp (e.g., 1 day)
      const LG = sortedLimits[2] || null; // Latest timestamp (far future)

      return {
        L0: {
          ...L0,
          total: filteredLimitCfg[0]?.limit0,
        },
        L1: {
          ...L1,
          total: filteredLimitCfg[0]?.limit1,
        },
        LG: {
          ...LG,
          total: filteredLimitCfg[0]?.limitGlobal,
        },
        tokenToCheck,
        asset: limitAsset,
      };
    },
    enabled: !!fromTokenId && !!toTokenId,
  });
}
