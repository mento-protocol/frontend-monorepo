import { getMentoSdk } from "@/features/sdk";
import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { useChainId } from "wagmi";
import type { ChainId } from "@/config/chains";
import type { PoolDisplay } from "../types";
import { LP_TOTAL_SUPPLY_HOLDER } from "../types";
import {
  createPoolUsdPricingContext,
  getUsdTokenPrices,
} from "../usd-quote-metadata";

export interface UserPosition {
  poolSharePercent: number;
  totalUsdValue: number | null;
  token0: {
    amount: number;
    usdValue: number | null;
    price: number | null;
  };
  token1: {
    amount: number;
    usdValue: number | null;
    price: number | null;
  };
}

interface UseUserPositionParams {
  pool: PoolDisplay;
  lpBalance: bigint | undefined;
  enabled?: boolean;
  chainId?: ChainId;
}

export function useUserPosition({
  pool,
  lpBalance,
  enabled = true,
  chainId,
}: UseUserPositionParams) {
  const walletChainId = useChainId() as ChainId;
  const resolvedChainId = chainId ?? walletChainId;
  const hasBalance = lpBalance !== undefined && lpBalance > 0n;

  return useQuery<UserPosition | null>({
    queryKey: [
      "user-position",
      pool.poolAddr,
      lpBalance?.toString(),
      resolvedChainId,
    ],
    queryFn: async () => {
      if (!lpBalance || lpBalance <= 0n) return null;

      const sdk = await getMentoSdk(resolvedChainId);
      const usdPricingContext = createPoolUsdPricingContext(
        sdk,
        resolvedChainId,
      );

      const [lpData, details] = await Promise.all([
        sdk.liquidity.getLPTokenBalance(pool.poolAddr, LP_TOTAL_SUPPLY_HOLDER),
        sdk.pools.getPoolDetails(pool.poolAddr),
      ]);

      const totalSupply = lpData.totalSupply;
      if (totalSupply <= 0n) return null;

      // Pool share percentage
      const poolSharePercent = Number((lpBalance * 10000n) / totalSupply) / 100;

      // User's proportional token amounts
      const userToken0 = (details.reserve0 * lpBalance) / totalSupply;
      const userToken1 = (details.reserve1 * lpBalance) / totalSupply;

      const userToken0Amount = Number(
        formatUnits(userToken0, pool.token0.decimals),
      );
      const userToken1Amount = Number(
        formatUnits(userToken1, pool.token1.decimals),
      );

      // Token prices from oracle (FPMM pools only)
      let token0Price: number | null = null;
      let token1Price: number | null = null;

      if (details.poolType === "FPMM" && details.pricing) {
        const usdTokenPrices = await getUsdTokenPrices({
          token0Address: details.token0,
          token1Address: details.token1,
          oraclePrice: details.pricing.oraclePrice,
          chainId: resolvedChainId,
          context: usdPricingContext,
        });
        if (usdTokenPrices) {
          token0Price = usdTokenPrices.token0PriceUsd;
          token1Price = usdTokenPrices.token1PriceUsd;
        }
      }

      // USD values
      const token0UsdValue =
        token0Price !== null ? userToken0Amount * token0Price : null;
      const token1UsdValue =
        token1Price !== null ? userToken1Amount * token1Price : null;
      const totalUsdValue =
        token0UsdValue !== null && token1UsdValue !== null
          ? token0UsdValue + token1UsdValue
          : null;

      return {
        poolSharePercent,
        totalUsdValue,
        token0: {
          amount: userToken0Amount,
          usdValue: token0UsdValue,
          price: token0Price,
        },
        token1: {
          amount: userToken1Amount,
          usdValue: token1UsdValue,
          price: token1Price,
        },
      };
    },
    enabled: enabled && hasBalance,
    staleTime: 10_000,
    gcTime: 30_000,
  });
}
