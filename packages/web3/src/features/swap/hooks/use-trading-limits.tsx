import { getTokenByAddress } from "@/config/tokens";
import { getMentoSdk, getTradablePairForTokens } from "@/features/sdk";
import { TokenSymbol, getTokenAddress } from "@mento-protocol/mento-sdk";
import { useQuery } from "@tanstack/react-query";

export function useTradingLimits(
  tokenInSymbol: string,
  tokenOutSymbol: string,
  chainId: number,
) {
  return useQuery({
    queryKey: ["trading-limits", tokenInSymbol, tokenOutSymbol, chainId],
    queryFn: async () => {
      if (!tokenInSymbol || !tokenOutSymbol) return null;

      const mento = await getMentoSdk(chainId);
      const tradablePair = await getTradablePairForTokens(
        chainId,
        tokenInSymbol as TokenSymbol,
        tokenOutSymbol as TokenSymbol,
      );

      if (
        !tradablePair ||
        !tradablePair.path ||
        tradablePair.path.length === 0
      ) {
        return null;
      }

      const exchangeId = tradablePair?.path?.[0]?.id;
      if (!exchangeId) return null;

      const tradingLimits = await mento.getTradingLimits(exchangeId);
      const limitCfg = await mento.getTradingLimitConfig(exchangeId);

      // Check limits for both tokens
      const tokenInAddress = getTokenAddress(
        chainId,
        tokenInSymbol as TokenSymbol,
      );
      const tokenOutAddress = getTokenAddress(
        chainId,
        tokenOutSymbol as TokenSymbol,
      );

      if (!tokenInAddress) {
        throw new Error(
          `${tokenInSymbol} token address not found on chain ${chainId}`,
        );
      }

      if (!tokenOutAddress) {
        throw new Error(
          `${tokenOutSymbol} token address not found on chain ${chainId}`,
        );
      }

      // Filter limits for tokenIn
      const tokenInLimits = tradingLimits.filter(
        (limit) => limit.asset === tokenInAddress,
      );
      const tokenInLimitCfg = limitCfg.filter(
        (limit) => limit.asset === tokenInAddress,
      );

      // Filter limits for tokenOut
      const tokenOutLimits = tradingLimits.filter(
        (limit) => limit.asset === tokenOutAddress,
      );
      const tokenOutLimitCfg = limitCfg.filter(
        (limit) => limit.asset === tokenOutAddress,
      );

      // Determine which token has limits configured
      let filteredTradingLimits, filteredLimitCfg, limitAsset;

      if (tokenInLimits.length > 0) {
        filteredTradingLimits = tokenInLimits;
        filteredLimitCfg = tokenInLimitCfg;
        limitAsset = tokenInAddress;
      } else if (tokenOutLimits.length > 0) {
        filteredTradingLimits = tokenOutLimits;
        filteredLimitCfg = tokenOutLimitCfg;
        limitAsset = tokenOutAddress;
      } else {
        // No limits configured for either token
        return null;
      }

      // Sort limits by 'until' timestamp in ascending order
      const sortedLimits = filteredTradingLimits.sort(
        (a, b) => a.until - b.until,
      );

      const tokenToCheck = limitAsset
        ? getTokenByAddress(limitAsset as `0x${string}`, chainId)?.symbol
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
    enabled: !!tokenInSymbol && !!tokenOutSymbol,
  });
}
