import { getTokenByAddress } from "@/config/tokens";
import { getMentoSdk, getTradablePairForTokens } from "@/features/sdk";
import {
  TokenSymbol,
  encodeRoutePath,
  getTokenAddress,
  type Pool,
  type TradingLimit,
} from "@mento-protocol/mento-sdk";
import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";

export interface FormattedTradingLimitTier {
  maxIn: string;
  maxOut: string;
  total: string;
  until: number;
}

export interface RouteTradingLimit {
  hopIndex: number;
  direction: "in" | "out";
  tokenSymbol: string;
  L0: FormattedTradingLimitTier | null;
  L1: FormattedTradingLimitTier | null;
  LG: FormattedTradingLimitTier | null;
}

// Helper to convert a bigint limit to an exact decimal string using token
// decimals. Kept as a string (not a float) so downstream comparisons stay
// precise for amounts near a limit boundary.
function formatLimit(value: bigint, decimals: number): string {
  return formatUnits(value, decimals);
}

function isSameAddress(addressA: string, addressB: string): boolean {
  return addressA.toLowerCase() === addressB.toLowerCase();
}

function getPoolIdentity(pool: Pool): string {
  return [
    pool.poolType,
    pool.poolAddr.toLowerCase(),
    pool.exchangeId?.toLowerCase() ?? "",
  ].join(":");
}

function formatTradingLimitTier(
  limit: TradingLimit | undefined,
): FormattedTradingLimitTier | null {
  if (!limit) return null;

  return {
    maxIn: formatLimit(limit.maxIn, limit.decimals),
    maxOut: formatLimit(limit.maxOut, limit.decimals),
    until: limit.until,
    total: formatLimit(limit.maxIn + limit.maxOut, limit.decimals),
  };
}

export async function getRouteTradingLimits({
  chainId,
  mento,
  route,
  tokenInAddress,
  tokenOutAddress,
}: {
  chainId: number;
  mento: Awaited<ReturnType<typeof getMentoSdk>>;
  route: Awaited<ReturnType<typeof getTradablePairForTokens>>;
  tokenInAddress: `0x${string}`;
  tokenOutAddress: `0x${string}`;
}): Promise<RouteTradingLimit[]> {
  const routerRoutes = encodeRoutePath(
    route.path,
    tokenInAddress,
    tokenOutAddress,
  );
  const poolsByIdentity = new Map(
    route.path.map((pool) => [getPoolIdentity(pool), pool]),
  );
  const limitsByPoolIdentity = new Map(
    await Promise.all(
      [...poolsByIdentity.entries()].map(
        async ([poolIdentity, pool]) =>
          [
            poolIdentity,
            await mento.trading.getPoolTradingLimits(pool),
          ] as const,
      ),
    ),
  );

  const routeLimits: RouteTradingLimit[] = [];

  for (const [hopIndex, hop] of routerRoutes.entries()) {
    const pool = route.path.find(
      (candidate) =>
        isSameAddress(candidate.factoryAddr, hop.factory) &&
        ((isSameAddress(candidate.token0, hop.from) &&
          isSameAddress(candidate.token1, hop.to)) ||
          (isSameAddress(candidate.token1, hop.from) &&
            isSameAddress(candidate.token0, hop.to))),
    );
    if (!pool) {
      throw new Error("Unable to load trading limits for the swap route.");
    }

    const poolLimits = limitsByPoolIdentity.get(getPoolIdentity(pool));
    if (!poolLimits) {
      throw new Error("Unable to load trading limits for the swap route.");
    }

    for (const [direction, asset] of [
      ["in", hop.from],
      ["out", hop.to],
    ] as const) {
      const assetLimits = poolLimits
        .filter((limit) => isSameAddress(limit.asset, asset))
        .sort((limitA, limitB) => limitA.until - limitB.until);
      if (assetLimits.length === 0) continue;

      const token = getTokenByAddress(asset, chainId);
      if (!token) {
        throw new Error(`Token address ${asset} not found on chain ${chainId}`);
      }

      routeLimits.push({
        hopIndex,
        direction,
        tokenSymbol: token.symbol,
        L0: formatTradingLimitTier(assetLimits[0]),
        L1: formatTradingLimitTier(assetLimits[1]),
        LG: formatTradingLimitTier(assetLimits[2]),
      });
    }
  }

  return routeLimits;
}

export function useTradingLimits(
  tokenInSymbol: string | undefined,
  tokenOutSymbol: string | undefined,
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

      return getRouteTradingLimits({
        chainId,
        mento,
        route: tradablePair,
        tokenInAddress: tokenInAddress as `0x${string}`,
        tokenOutAddress: tokenOutAddress as `0x${string}`,
      });
    },
    enabled: !!tokenInSymbol && !!tokenOutSymbol,
  });
}
