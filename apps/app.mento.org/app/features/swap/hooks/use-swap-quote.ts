import { useQuery } from "@tanstack/react-query";
import { ethers } from "ethers";
import { useEffect } from "react";
import { toast } from "@repo/ui";
import { SWAP_QUOTE_REFETCH_INTERVAL } from "@/lib/config/consts";
import { type TokenId, Tokens, getTokenAddress } from "@/lib/config/tokens";
import { getMentoSdk, getTradablePairForTokens } from "@/features/sdk";
import type { SwapDirection } from "@/features/swap/types";
import {
  calcExchangeRate,
  invertExchangeRate,
  parseInputExchangeAmount,
} from "@/features/swap/utils";
import { fromWei } from "@/lib/utils/amount";
import { useDebounce } from "@/lib/utils/debounce";
import { logger } from "@/lib/utils/logger";
import { useChainId } from "wagmi";

export function useSwapQuote(
  amount: string | number,
  direction: SwapDirection,
  fromTokenId: TokenId,
  toTokenId: TokenId,
) {
  const chainId = useChainId();
  const fromToken = Tokens[fromTokenId];
  const toToken = Tokens[toTokenId];
  const debouncedAmount = useDebounce(amount, 350);

  const { isLoading, isError, error, data, refetch } = useQuery<
    ISwapData | null,
    ISwapError
  >(
    ["use-swap-quote", debouncedAmount, fromTokenId, toTokenId, direction],
    async () => {
      const fromTokenAddr = getTokenAddress(fromTokenId, chainId);
      const toTokenAddr = getTokenAddress(toTokenId, chainId);
      const isSwapIn = direction === "in";
      const amountWei = parseInputExchangeAmount(
        amount,
        isSwapIn ? fromTokenId : toTokenId,
      );
      const amountWeiBN = ethers.BigNumber.from(amountWei);
      const amountDecimals = isSwapIn ? fromToken.decimals : toToken.decimals;
      const quoteDecimals = isSwapIn ? toToken.decimals : fromToken.decimals;
      if (amountWeiBN.lte(0) || !fromToken || !toToken) return null;
      const mento = await getMentoSdk(chainId);
      const tradablePair = await getTradablePairForTokens(
        chainId,
        fromTokenId,
        toTokenId,
      );

      const quoteWei = (
        isSwapIn
          ? await mento.getAmountOut(
              fromTokenAddr,
              toTokenAddr,
              amountWeiBN,
              tradablePair,
            )
          : await mento.getAmountIn(
              fromTokenAddr,
              toTokenAddr,
              amountWeiBN,
              tradablePair,
            )
      ).toString();

      const quote = fromWei(quoteWei, quoteDecimals);
      const rateIn = calcExchangeRate(
        amountWei,
        amountDecimals,
        quoteWei,
        quoteDecimals,
      );
      const rate = isSwapIn ? rateIn : invertExchangeRate(rateIn);

      return {
        amountWei,
        quoteWei,
        quote,
        rate,
      };
    },
    {
      staleTime: SWAP_QUOTE_REFETCH_INTERVAL,
      refetchInterval: SWAP_QUOTE_REFETCH_INTERVAL,
    },
  );

  useEffect(() => {
    if (error) {
      const toastError = getToastErrorMessage(error.message, {
        fromTokenSymbol: fromToken.symbol,
        toTokenSymbol: toToken.symbol,
      });
      toast.error(toastError);
      logger.error(error);
    }
  }, [error, fromToken.symbol, toToken.symbol]);

  return {
    isLoading,
    isError,
    amountWei: data?.amountWei || "0",
    quoteWei: data?.quoteWei || "0",
    quote: data?.quote || "0",
    rate: data?.rate,
    refetch,
  };
}

function getToastErrorMessage(
  swapErrorMessage: string,
  { fromTokenSymbol, toTokenSymbol, type }: IGetToastErrorOptions = {},
): string {
  switch (true) {
    case swapErrorMessage.includes("overflow x1y1"):
      return "Amount in is too large";
    case swapErrorMessage.includes("can't create fixidity number larger than"):
      return "Amount out is too large";
    case swapErrorMessage.includes("no valid median"):
    case swapErrorMessage.includes(
      "Trading is suspended for this reference rate",
    ):
      return `Trading temporarily paused.  Unable to determine accurate ${fromTokenSymbol} to ${toTokenSymbol} exchange rate now. Please try again later.`;
    default:
      return "Unable to fetch swap amount";
  }
}

interface IGetToastErrorOptions {
  fromTokenSymbol?: string;
  toTokenSymbol?: string;
  type?: "quote" | "swap";
}

interface ISwapError {
  message: string;
}

interface ISwapData {
  amountWei: string;
  quoteWei: string;
  quote: string;
  rate: string;
}
