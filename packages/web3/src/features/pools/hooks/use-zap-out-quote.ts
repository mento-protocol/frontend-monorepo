import { getMentoSdk } from "@/features/sdk";
import { useDebounce } from "@/utils/debounce";
import { useQuery } from "@tanstack/react-query";
import { parseUnits, type Address } from "viem";
import { useChainId } from "wagmi";
import type { ChainId } from "@/config/chains";
import type { PoolDisplay, SlippageOption } from "../types";

export interface ZapOutQuoteResult {
  estimatedMinTokenOut: bigint;
  amountOutFromA: bigint;
  amountOutFromB: bigint;
  amountAMin: bigint;
  amountBMin: bigint;
}

interface UseZapOutQuoteParams {
  pool: PoolDisplay;
  tokenOut: string;
  lpAmount: string;
  slippage: SlippageOption;
  chainId?: ChainId;
}

function getZapOutQuoteRawError(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

function isDeterministicZapOutRouteError(message: string): boolean {
  return /no viable zap-out route|route not found|no route|route unavailable|insufficient liquidity|insufficientliquidity|insufficient reserves|insufficient output amount|bb55fd27|execution reverted|call execution error/i.test(
    message,
  );
}

function toZapOutQuoteErrorMessage(message: string): string {
  if (isDeterministicZapOutRouteError(message)) {
    return "No viable zap-out route for this amount. Reduce amount or use balanced mode.";
  }

  return "Unable to quote single-token removal right now.";
}

export function useZapOutQuote({
  pool,
  tokenOut,
  lpAmount,
  slippage,
  chainId,
}: UseZapOutQuoteParams) {
  const walletChainId = useChainId() as ChainId;
  const resolvedChainId = chainId ?? walletChainId;

  const debouncedAmount = useDebounce(lpAmount, 350);
  const isValidAmount = !!debouncedAmount && Number(debouncedAmount) > 0;

  return useQuery<ZapOutQuoteResult | null>({
    queryKey: [
      "zap-out-quote",
      pool.poolAddr,
      tokenOut,
      debouncedAmount,
      slippage,
      resolvedChainId,
    ],
    queryFn: async () => {
      if (!isValidAmount) return null;

      const sdk = await getMentoSdk(resolvedChainId);
      const liquidityWei = parseUnits(debouncedAmount, 18);

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);

      try {
        const quote = await sdk.liquidity.quoteZapOut(
          pool.poolAddr as Address,
          tokenOut,
          liquidityWei,
          { slippageTolerance: slippage, deadline },
        );

        return {
          estimatedMinTokenOut: quote.estimatedMinTokenOut,
          amountOutFromA: quote.amountOutFromA,
          amountOutFromB: quote.amountOutFromB,
          amountAMin: quote.amountAMin,
          amountBMin: quote.amountBMin,
        };
      } catch (error) {
        const errorMessage = getZapOutQuoteRawError(error);
        throw new Error(toZapOutQuoteErrorMessage(errorMessage));
      }
    },
    enabled: isValidAmount,
    retry: (failureCount, error) => {
      const errorMessage = getZapOutQuoteRawError(error);
      if (isDeterministicZapOutRouteError(errorMessage)) return false;
      return failureCount < 2;
    },
    staleTime: 5000,
    gcTime: 30_000,
  });
}
