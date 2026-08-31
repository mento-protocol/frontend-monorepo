import { getMentoSdk, getPublicClient } from "@/features/sdk";
import { useDebounce } from "@/utils/debounce";
import { useQuery } from "@tanstack/react-query";
import { parseUnits, type Address } from "viem";
import { useChainId } from "wagmi";
import type { ChainId } from "@/config/chains";
import type { PoolDisplay, SlippageOption } from "../types";
import { LP_TOTAL_SUPPLY_HOLDER } from "../types";
import {
  assertBindingZapInPlan,
  prepareBindingZapInPlan,
} from "../zap-in-split";

export interface ZapInQuoteResult {
  estimatedMinLiquidity: bigint;
  amountOutFromA: bigint;
  amountOutFromB: bigint;
  amountAMin: bigint;
  amountBMin: bigint;
  totalSupply: bigint;
}

interface UseZapInQuoteParams {
  pool: PoolDisplay;
  tokenIn: string;
  amountIn: string;
  slippage: SlippageOption;
  chainId?: ChainId;
}

export function useZapInQuote({
  pool,
  tokenIn,
  amountIn,
  slippage,
  chainId,
}: UseZapInQuoteParams) {
  const walletChainId = useChainId() as ChainId;
  const resolvedChainId = chainId ?? walletChainId;

  const debouncedAmount = useDebounce(amountIn, 350);
  const isValidAmount = !!debouncedAmount && Number(debouncedAmount) > 0;

  return useQuery<ZapInQuoteResult | null>({
    queryKey: [
      "zap-in-quote",
      pool.poolAddr,
      tokenIn,
      debouncedAmount,
      slippage,
      resolvedChainId,
    ],
    queryFn: async () => {
      if (!isValidAmount) return null;

      const [sdk, publicClient] = await Promise.all([
        getMentoSdk(resolvedChainId),
        Promise.resolve(getPublicClient(resolvedChainId)),
      ]);

      const tokenDecimals =
        tokenIn.toLowerCase() === pool.token0.address.toLowerCase()
          ? pool.token0.decimals
          : pool.token1.decimals;

      const amountInWei = parseUnits(debouncedAmount, tokenDecimals);

      const { deadline, plan } = await prepareBindingZapInPlan({
        sdk,
        publicClient,
        poolAddress: pool.poolAddr as Address,
        tokenIn: tokenIn as Address,
        amountIn: amountInWei,
        recipient: tokenIn as Address,
      });

      const prepared = await sdk.liquidity.prepareZapIn({
        poolAddress: pool.poolAddr,
        tokenIn,
        amountIn: amountInWei,
        amountInSplit: plan.projection.sdkSplitRatio,
        recipient: tokenIn,
        options: { slippageTolerance: slippage, deadline },
      });
      assertBindingZapInPlan(prepared.details, plan);

      // Get LP token total supply for share calculation
      const lpBalance = await sdk.liquidity.getLPTokenBalance(
        pool.poolAddr,
        LP_TOTAL_SUPPLY_HOLDER,
      );

      return {
        estimatedMinLiquidity: prepared.quote.estimatedMinLiquidity,
        amountOutFromA: prepared.quote.amountOutFromA,
        amountOutFromB: prepared.quote.amountOutFromB,
        amountAMin: prepared.quote.amountAMin,
        amountBMin: prepared.quote.amountBMin,
        totalSupply: lpBalance.totalSupply,
      };
    },
    enabled: isValidAmount,
    staleTime: 0,
    gcTime: 30_000,
    refetchOnMount: "always",
  });
}
