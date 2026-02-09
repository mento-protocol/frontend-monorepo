import { getMentoSdk } from "@/features/sdk";
import { fromWei, toWei } from "@/utils/amount";
import { useDebounce } from "@/utils/debounce";
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { useChainId } from "wagmi";
import type { ChainId } from "@/config/chains";
import type { PoolDisplay } from "../types";

export interface LiquidityQuoteResult {
  amountA: bigint;
  amountB: bigint;
  liquidity: bigint;
  totalSupply: bigint;
}

interface UseLiquidityQuoteParams {
  pool: PoolDisplay;
  token0Amount: string;
  token1Amount: string;
  lastEditedToken: 0 | 1;
}

export function useLiquidityQuote({
  pool,
  token0Amount,
  token1Amount,
  lastEditedToken,
}: UseLiquidityQuoteParams) {
  const chainId = useChainId() as ChainId;

  const driverAmount = lastEditedToken === 0 ? token0Amount : token1Amount;
  const debouncedAmount = useDebounce(driverAmount, 350);
  const isValidAmount = !!debouncedAmount && Number(debouncedAmount) > 0;

  return useQuery<LiquidityQuoteResult | null>({
    queryKey: [
      "liquidity-quote",
      pool.poolAddr,
      debouncedAmount,
      lastEditedToken,
      chainId,
    ],
    queryFn: async () => {
      if (!isValidAmount) return null;

      const sdk = await getMentoSdk(chainId);

      // Get raw pool reserves for proportional calculation
      const details = await sdk.pools.getPoolDetails(pool.poolAddr);
      const reserve0 = details.reserve0;
      const reserve1 = details.reserve1;

      const driverDecimals =
        lastEditedToken === 0 ? pool.token0.decimals : pool.token1.decimals;
      const driverWei = toWei(debouncedAmount, driverDecimals);

      // Calculate proportional amount using reserves ratio
      let amount0: bigint;
      let amount1: bigint;

      if (lastEditedToken === 0) {
        amount0 = BigInt(driverWei.toFixed(0));
        // amount1 = amount0 * reserve1 / reserve0
        amount1 = reserve0 > 0n ? (amount0 * reserve1) / reserve0 : 0n;
      } else {
        amount1 = BigInt(driverWei.toFixed(0));
        // amount0 = amount1 * reserve0 / reserve1
        amount0 = reserve1 > 0n ? (amount1 * reserve0) / reserve1 : 0n;
      }

      // Get quote from the Router on-chain for exact LP token estimate
      const quote = await sdk.liquidity.quoteAddLiquidity(
        pool.poolAddr as Address,
        pool.token0.address as Address,
        amount0,
        pool.token1.address as Address,
        amount1,
      );

      // Get LP token total supply for share calculation
      const lpBalance = await sdk.liquidity.getLPTokenBalance(
        pool.poolAddr,
        "0x0000000000000000000000000000000000000001",
      );

      return {
        amountA: quote.amountA,
        amountB: quote.amountB,
        liquidity: quote.liquidity,
        totalSupply: lpBalance.totalSupply,
      };
    },
    enabled: isValidAmount,
    staleTime: 5000,
    gcTime: 30_000,
  });
}

/**
 * Formats the proportional amount from a quote result for the non-edited token input.
 */
export function getProportionalAmount(
  quote: LiquidityQuoteResult | null | undefined,
  lastEditedToken: 0 | 1,
  pool: PoolDisplay,
): string {
  if (!quote) return "";
  const amount = lastEditedToken === 0 ? quote.amountB : quote.amountA;
  const decimals =
    lastEditedToken === 0 ? pool.token1.decimals : pool.token0.decimals;
  if (amount === 0n) return "";
  return fromWei(amount.toString(), decimals);
}
