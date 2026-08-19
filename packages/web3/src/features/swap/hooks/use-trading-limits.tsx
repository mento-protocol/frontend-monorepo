import { getTokenByAddress } from "@/config/tokens";
import { type ChainId } from "@/config/chains";
import { getPublicClient, getTradablePairForTokens } from "@/features/sdk";
import {
  TokenSymbol,
  encodeRoutePath,
  getTokenAddress,
  type Pool,
} from "@mento-protocol/mento-sdk";
import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { resolveRouteHops } from "../route-hops";
import {
  readPoolTradingLimitsStrict,
  type TaggedTradingLimit,
  type TradingLimitsPublicClient,
} from "../strict-trading-limits";

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
  limit: TaggedTradingLimit | undefined,
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
  publicClient,
  route,
  tokenInAddress,
  tokenOutAddress,
  loadPoolTradingLimits = readPoolTradingLimitsStrict,
}: {
  chainId: number;
  publicClient: TradingLimitsPublicClient;
  route: Awaited<ReturnType<typeof getTradablePairForTokens>>;
  tokenInAddress: `0x${string}`;
  tokenOutAddress: `0x${string}`;
  loadPoolTradingLimits?: typeof readPoolTradingLimitsStrict;
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
            await loadPoolTradingLimits(publicClient, chainId, pool),
          ] as const,
      ),
    ),
  );

  const resolvedHops = resolveRouteHops(route, routerRoutes);
  if (!resolvedHops) {
    throw new Error("Unable to load trading limits for the swap route.");
  }

  const routeLimits: RouteTradingLimit[] = [];

  for (const { hop, hopIndex, pool } of resolvedHops) {
    const poolLimits = limitsByPoolIdentity.get(getPoolIdentity(pool));
    if (!poolLimits) {
      throw new Error("Unable to load trading limits for the swap route.");
    }

    for (const [direction, asset] of [
      ["in", hop.from],
      ["out", hop.to],
    ] as const) {
      const assetLimits = poolLimits.filter((limit) =>
        isSameAddress(limit.asset, asset),
      );
      if (assetLimits.length === 0) continue;
      const assetLimitsByTier = new Map(
        assetLimits.map((limit) => [limit.tier, limit]),
      );

      const token = getTokenByAddress(asset, chainId);
      if (!token) {
        throw new Error(`Token address ${asset} not found on chain ${chainId}`);
      }

      routeLimits.push({
        hopIndex,
        direction,
        tokenSymbol: token.symbol,
        L0: formatTradingLimitTier(assetLimitsByTier.get("L0")),
        L1: formatTradingLimitTier(assetLimitsByTier.get("L1")),
        LG: formatTradingLimitTier(assetLimitsByTier.get("LG")),
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
        throw new Error("Unable to load trading limits for the swap route.");
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
        publicClient: getPublicClient(chainId as ChainId),
        route: tradablePair,
        tokenInAddress: tokenInAddress as `0x${string}`,
        tokenOutAddress: tokenOutAddress as `0x${string}`,
      });
    },
    enabled: !!tokenInSymbol && !!tokenOutSymbol,
  });
}
