import { getTokenByAddress } from "@/config/tokens";
import { getMentoSdk, getTradablePairForTokens } from "@/features/sdk";
import {
  TokenSymbol,
  getTokenAddress,
  TradingLimit,
  Pool,
} from "@mento-protocol/mento-sdk";
import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";

// Helper to convert bigint limit to number using token decimals
function formatLimit(value: bigint, decimals: number): number {
  return parseFloat(formatUnits(value, decimals));
}

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

      const pool: Pool | undefined = tradablePair.path[0];
      if (!pool) return null;

      const tradingLimits: TradingLimit[] =
        await mento.trading.getPoolTradingLimits(pool);

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
        (limit: TradingLimit) =>
          limit.asset.toLowerCase() === tokenInAddress.toLowerCase(),
      );

      // Filter limits for tokenOut
      const tokenOutLimits = tradingLimits.filter(
        (limit: TradingLimit) =>
          limit.asset.toLowerCase() === tokenOutAddress.toLowerCase(),
      );

      // Determine which token has limits configured
      let filteredTradingLimits: TradingLimit[];
      let limitAsset: string;

      if (tokenInLimits.length > 0) {
        filteredTradingLimits = tokenInLimits;
        limitAsset = tokenInAddress;
      } else if (tokenOutLimits.length > 0) {
        filteredTradingLimits = tokenOutLimits;
        limitAsset = tokenOutAddress;
      } else {
        // No limits configured for either token
        return null;
      }

      // Sort limits by 'until' timestamp in ascending order
      const sortedLimits = [...filteredTradingLimits].sort(
        (a: TradingLimit, b: TradingLimit) => a.until - b.until,
      );

      const tokenToCheck = limitAsset
        ? getTokenByAddress(limitAsset as `0x${string}`, chainId)?.symbol
        : null;

      // Extract L0, L1, and LG limits based on timestamp ranking
      const L0 = sortedLimits[0] || null; // Soonest timestamp (e.g., 5 minutes)
      const L1 = sortedLimits[1] || null; // Middle timestamp (e.g., 1 day)
      const LG = sortedLimits[2] || null; // Latest timestamp (far future)

      return {
        L0: L0
          ? {
              asset: L0.asset,
              maxIn: formatLimit(L0.maxIn, L0.decimals),
              maxOut: formatLimit(L0.maxOut, L0.decimals),
              until: L0.until,
              decimals: L0.decimals,
              total: formatLimit(L0.maxIn + L0.maxOut, L0.decimals),
            }
          : null,
        L1: L1
          ? {
              asset: L1.asset,
              maxIn: formatLimit(L1.maxIn, L1.decimals),
              maxOut: formatLimit(L1.maxOut, L1.decimals),
              until: L1.until,
              decimals: L1.decimals,
              total: formatLimit(L1.maxIn + L1.maxOut, L1.decimals),
            }
          : null,
        LG: LG
          ? {
              asset: LG.asset,
              maxIn: formatLimit(LG.maxIn, LG.decimals),
              maxOut: formatLimit(LG.maxOut, LG.decimals),
              until: LG.until,
              decimals: LG.decimals,
              total: formatLimit(LG.maxIn + LG.maxOut, LG.decimals),
            }
          : null,
        tokenToCheck,
        asset: limitAsset,
      };
    },
    enabled: !!tokenInSymbol && !!tokenOutSymbol,
  });
}
