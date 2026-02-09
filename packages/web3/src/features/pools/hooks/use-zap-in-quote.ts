import { getMentoSdk } from "@/features/sdk";
import { toWei } from "@/utils/amount";
import { useDebounce } from "@/utils/debounce";
import { useQuery } from "@tanstack/react-query";
import { useChainId } from "wagmi";
import type { ChainId } from "@/config/chains";
import type { PoolDisplay, SlippageOption } from "../types";

export interface ZapInQuoteResult {
  expectedLiquidity: bigint;
  amountOutMinA: bigint;
  amountOutMinB: bigint;
  amountAMin: bigint;
  amountBMin: bigint;
  totalSupply: bigint;
}

interface UseZapInQuoteParams {
  pool: PoolDisplay;
  tokenIn: string;
  amountIn: string;
  slippage: SlippageOption;
}

export function useZapInQuote({
  pool,
  tokenIn,
  amountIn,
  slippage,
}: UseZapInQuoteParams) {
  const chainId = useChainId() as ChainId;

  const debouncedAmount = useDebounce(amountIn, 350);
  const isValidAmount = !!debouncedAmount && Number(debouncedAmount) > 0;

  return useQuery<ZapInQuoteResult | null>({
    queryKey: [
      "zap-in-quote",
      pool.poolAddr,
      tokenIn,
      debouncedAmount,
      slippage,
      chainId,
    ],
    queryFn: async () => {
      if (!isValidAmount) return null;

      const sdk = await getMentoSdk(chainId);

      const tokenDecimals =
        tokenIn === pool.token0.address
          ? pool.token0.decimals
          : pool.token1.decimals;

      const amountInWei = BigInt(
        toWei(debouncedAmount, tokenDecimals).toFixed(0),
      );

      const quote = await sdk.liquidity.quoteZapIn(
        pool.poolAddr,
        tokenIn,
        amountInWei,
        0.5,
        { slippageTolerance: slippage },
      );

      // Get LP token total supply for share calculation
      const lpBalance = await sdk.liquidity.getLPTokenBalance(
        pool.poolAddr,
        "0x0000000000000000000000000000000000000001",
      );

      return {
        expectedLiquidity: quote.expectedLiquidity,
        amountOutMinA: quote.amountOutMinA,
        amountOutMinB: quote.amountOutMinB,
        amountAMin: quote.amountAMin,
        amountBMin: quote.amountBMin,
        totalSupply: lpBalance.totalSupply,
      };
    },
    enabled: isValidAmount,
    staleTime: 5000,
    gcTime: 30_000,
  });
}
