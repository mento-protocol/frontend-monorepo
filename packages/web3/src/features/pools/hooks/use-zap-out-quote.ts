import { getMentoSdk } from "@/features/sdk";
import { useDebounce } from "@/utils/debounce";
import { useQuery } from "@tanstack/react-query";
import { parseUnits, type Address } from "viem";
import { useChainId } from "wagmi";
import type { ChainId } from "@/config/chains";
import type { PoolDisplay, SlippageOption } from "../types";

export interface ZapOutQuoteResult {
  expectedTokenOut: bigint;
  amountOutMinA: bigint;
  amountOutMinB: bigint;
  amountAMin: bigint;
  amountBMin: bigint;
}

interface UseZapOutQuoteParams {
  pool: PoolDisplay;
  tokenOut: string;
  lpAmount: string;
  slippage: SlippageOption;
}

export function useZapOutQuote({
  pool,
  tokenOut,
  lpAmount,
  slippage,
}: UseZapOutQuoteParams) {
  const chainId = useChainId() as ChainId;

  const debouncedAmount = useDebounce(lpAmount, 350);
  const isValidAmount = !!debouncedAmount && Number(debouncedAmount) > 0;

  return useQuery<ZapOutQuoteResult | null>({
    queryKey: [
      "zap-out-quote",
      pool.poolAddr,
      tokenOut,
      debouncedAmount,
      slippage,
      chainId,
    ],
    queryFn: async () => {
      if (!isValidAmount) return null;

      const sdk = await getMentoSdk(chainId);
      const liquidityWei = parseUnits(debouncedAmount, 18);

      const quote = await sdk.liquidity.quoteZapOut(
        pool.poolAddr as Address,
        tokenOut,
        liquidityWei,
        { slippageTolerance: slippage },
      );

      return {
        expectedTokenOut: quote.expectedTokenOut,
        amountOutMinA: quote.amountOutMinA,
        amountOutMinB: quote.amountOutMinB,
        amountAMin: quote.amountAMin,
        amountBMin: quote.amountBMin,
      };
    },
    enabled: isValidAmount,
    staleTime: 5000,
    gcTime: 30_000,
  });
}
