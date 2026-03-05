import { getMentoSdk } from "@/features/sdk";
import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { useChainId } from "wagmi";
import type { ChainId } from "@/config/chains";
import type { PoolDisplay } from "../types";
import { LP_TOTAL_SUPPLY_HOLDER } from "../types";

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
}

export function useUserPosition({
  pool,
  lpBalance,
  enabled = true,
}: UseUserPositionParams) {
  const chainId = useChainId() as ChainId;
  const hasBalance = lpBalance !== undefined && lpBalance > 0n;

  return useQuery<UserPosition | null>({
    queryKey: ["user-position", pool.poolAddr, lpBalance?.toString(), chainId],
    queryFn: async () => {
      if (!lpBalance || lpBalance <= 0n) return null;

      const sdk = await getMentoSdk(chainId);

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
        // oraclePrice = price of token0 in terms of token1
        token0Price = details.pricing.oraclePrice;
        token1Price = 1; // token1 is assumed to be USD-pegged stablecoin
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
