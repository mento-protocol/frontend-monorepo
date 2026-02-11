import { getMentoSdk } from "@/features/sdk";
import { useDebounce } from "@/utils/debounce";
import { useQuery } from "@tanstack/react-query";
import { parseUnits, type Address } from "viem";
import { useChainId } from "wagmi";
import type { ChainId } from "@/config/chains";
import type { PoolDisplay } from "../types";
import { LP_TOTAL_SUPPLY_HOLDER } from "../types";

export interface RemoveLiquidityQuoteResult {
  amount0: bigint;
  amount1: bigint;
  totalSupply: bigint;
}

interface UseRemoveLiquidityQuoteParams {
  pool: PoolDisplay;
  lpAmount: string;
}

export function useRemoveLiquidityQuote({
  pool,
  lpAmount,
}: UseRemoveLiquidityQuoteParams) {
  const chainId = useChainId() as ChainId;

  const debouncedAmount = useDebounce(lpAmount, 350);
  const isValidAmount = !!debouncedAmount && Number(debouncedAmount) > 0;

  return useQuery<RemoveLiquidityQuoteResult | null>({
    queryKey: [
      "remove-liquidity-quote",
      pool.poolAddr,
      debouncedAmount,
      chainId,
    ],
    queryFn: async () => {
      if (!isValidAmount) return null;

      const sdk = await getMentoSdk(chainId);
      const liquidityWei = parseUnits(debouncedAmount, 18);

      const quote = await sdk.liquidity.quoteRemoveLiquidity(
        pool.poolAddr as Address,
        liquidityWei,
      );

      const lpBalance = await sdk.liquidity.getLPTokenBalance(
        pool.poolAddr,
        LP_TOTAL_SUPPLY_HOLDER,
      );

      return {
        amount0: quote.amount0,
        amount1: quote.amount1,
        totalSupply: lpBalance.totalSupply,
      };
    },
    enabled: isValidAmount,
    staleTime: 5000,
    gcTime: 30_000,
  });
}
