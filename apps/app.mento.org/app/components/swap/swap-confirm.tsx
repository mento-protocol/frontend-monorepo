"use client";

import { TokenSymbol } from "@mento-protocol/mento-sdk";
import { Button, IconLoading, TokenIcon } from "@repo/ui";
import {
  calculateRequiredReserveBalance,
  formatWithMaxDecimals,
  formValuesAtom,
  getMaxSellAmount,
  getMinBuyAmount,
  logger,
  SwapDirection,
  useAccountBalances,
  useGasEstimation,
  useOptimizedSwapQuote,
  useSwapAllowance,
  useSwapTransaction,
  useTokenOptions,
} from "@repo/web3";
import { useAccount, useChainId } from "@repo/web3/wagmi";
import { useAtom } from "jotai";
import { ArrowRight } from "lucide-react";
import { useMemo } from "react";
import { useReserveBalance } from "./use-reserve-balance";

export function SwapConfirm() {
  const [formValues] = useAtom(formValuesAtom);

  const { address, isConnected } = useAccount();
  const chainId = useChainId();

  const amount = String(formValues?.amount || "");
  const direction = (formValues?.direction || "in") as SwapDirection;
  const tokenInSymbol = formValues?.tokenInSymbol || TokenSymbol.cUSD;
  const tokenOutSymbol = formValues?.tokenOutSymbol || TokenSymbol.CELO;
  const slippage = String(formValues?.slippage || "0.5");

  const { data: balancesFromHook } = useAccountBalances({ address, chainId });
  const { allTokenOptions } = useTokenOptions(undefined, balancesFromHook);

  const {
    amountWei,
    quote,
    quoteWei,
    rate,
    fromTokenUSDValue,
    toTokenUSDValue,
  } = useOptimizedSwapQuote(amount, direction, tokenInSymbol, tokenOutSymbol);

  const swapValues = useMemo(() => {
    let computedFromAmountWei = amountWei;
    let computedThresholdAmountWei: string;

    if (direction === "in") {
      // Selling exact amount of fromToken (swapIn)
      // Don't adjust the amount - use what the user entered
      computedFromAmountWei = amountWei;
      // Minimum amount of toToken we're willing to receive
      computedThresholdAmountWei = getMinBuyAmount(quoteWei, slippage).toFixed(
        0,
      );

      return {
        fromAmount: amount,
        fromAmountWei: computedFromAmountWei,
        toAmount: quote,
        toAmountWei: quoteWei,
        thresholdAmountInWei: computedThresholdAmountWei,
      };
    }

    // Direction "out" - Buying exact amount of toToken (swapOut)
    // For swapOut: we specify exact amount to buy and max amount to sell
    // fromAmountWei is what we expect to sell (quote)
    // thresholdAmountWei is the MAXIMUM we're willing to sell (quote + slippage)
    computedFromAmountWei = quoteWei; // Expected sell amount
    computedThresholdAmountWei = getMaxSellAmount(quoteWei, slippage).toFixed(
      0,
    ); // Max sell amount

    return {
      fromAmount: quote,
      fromAmountWei: computedFromAmountWei,
      toAmount: amount.toString(),
      toAmountWei: amountWei, // Exact amount we want to buy
      thresholdAmountInWei: computedThresholdAmountWei,
    };
  }, [amount, amountWei, quote, quoteWei, direction, slippage]);

  const {
    fromAmount,
    fromAmountWei,
    toAmount,
    toAmountWei,
    thresholdAmountInWei,
  } = swapValues;

  const { sendSwapTx, isSwapTxLoading, isSwapTxReceiptLoading } =
    useSwapTransaction(
      chainId,
      tokenInSymbol,
      tokenOutSymbol,
      fromAmountWei,
      thresholdAmountInWei,
      direction,
      address,
      true,
      {
        fromAmount,
        toAmount,
        toAmountWei,
      },
    );

  const approveAmount = direction === "in" ? amountWei : thresholdAmountInWei;

  const { skipApprove } = useSwapAllowance({
    chainId,
    tokenInSymbol,
    tokenOutSymbol,
    approveAmount,
    address,
  });

  const { data: gasEstimate, isLoading: isGasEstimating } = useGasEstimation({
    amount,
    quote,
    tokenInSymbol,
    tokenOutSymbol,
    direction,
    address: address || "",
    chainId,
    slippage,
    skipApprove,
  });

  // Calculate required reserve balance for collateral assets.
  const requiredReserveBalanceInWei = useMemo(() => {
    if (!chainId) return undefined;
    return calculateRequiredReserveBalance(
      direction,
      quoteWei,
      amount,
      tokenOutSymbol,
      chainId,
    );
  }, [direction, quoteWei, amount, tokenOutSymbol, chainId]);

  // Check reserve balance for collateral assets and show toast on error.
  const { hasInsufficientReserveBalance, isReserveCheckLoading } =
    useReserveBalance({
      chainId,
      tokenOutSymbol,
      requiredReserveBalanceInWei,
      enabled:
        !!chainId &&
        !!requiredReserveBalanceInWei &&
        !!quote &&
        quote !== "0" &&
        !!amount &&
        isConnected,
    });

  // Calculate sell USD value with fallback
  const sellUSDValue = useMemo(() => {
    // First check if we have a value from formValues
    const passedValue = formValues?.sellUSDValue;
    if (passedValue && passedValue !== "0") {
      return passedValue;
    }

    // Fallback to calculating it ourselves
    if (direction === "in") {
      // selling from-token
      return tokenInSymbol === "cUSD"
        ? amount || "0"
        : fromTokenUSDValue || "0";
    } else {
      // still selling from-token (but user typed in Buy first)
      return tokenInSymbol === "cUSD" ? quote || "0" : fromTokenUSDValue || "0";
    }
  }, [
    formValues?.sellUSDValue,
    direction,
    tokenInSymbol,
    amount,
    quote,
    fromTokenUSDValue,
  ]);

  // Calculate buy USD value with fallback
  const buyUSDValue = useMemo(() => {
    // First check if we have a value from formValues
    const passedValue = formValues?.buyUSDValue;
    if (passedValue && passedValue !== "0") {
      return passedValue;
    }

    // Fallback to calculating it ourselves
    if (direction === "in") {
      return tokenOutSymbol === "cUSD" ? quote || "0" : toTokenUSDValue || "0";
    } else {
      // we're buying the to-token
      return tokenOutSymbol === "cUSD" ? amount || "0" : toTokenUSDValue || "0";
    }
  }, [
    formValues?.buyUSDValue,
    direction,
    tokenOutSymbol,
    amount,
    quote,
    toTokenUSDValue,
  ]);

  async function onSubmit() {
    if (!rate || !amountWei || !address || !isConnected) return;

    try {
      await sendSwapTx();
    } catch (error) {
      // Error handling is done in the hook
      logger.error("Swap submission error:", error);
    }
  }

  const fromToken = allTokenOptions.find(
    (token) => token.symbol === tokenInSymbol,
  );
  const toToken = allTokenOptions.find(
    (token) => token.symbol === tokenOutSymbol,
  );

  if (!formValues) {
    return null;
  }

  const isSell = direction === "in";

  return (
    <div className="flex h-full flex-col gap-6">
      <div className="flex w-full flex-row items-center justify-between md:w-[520px]">
        <div className="bg-incard md:h-50 md:w-50 flex aspect-square h-32 flex-col items-center justify-center gap-2 md:aspect-auto">
          <TokenIcon
            token={fromToken}
            className="h-10 w-10 bg-transparent md:h-14 md:w-14"
            size={56}
          />
          <span
            className="text-center text-xl font-medium md:text-3xl"
            data-testid="sellAmountLabel"
          >
            {formatWithMaxDecimals(fromAmount)}
          </span>
          <span
            className="text-muted-foreground text-sm md:text-base"
            data-testid="sellUsdAmountLabel"
          >
            ~$
            {isSell
              ? formatWithMaxDecimals(sellUSDValue)
              : formatWithMaxDecimals(buyUSDValue)}
          </span>
        </div>
        <div className="text-muted-foreground md:w-30 relative hidden h-full items-center justify-center p-0 md:flex">
          <div className="swap-deco-1 bg-incard absolute left-0 top-0 block h-10 w-10"></div>
          <div className="swap-deco-2 bg-incard left-15 absolute top-5 block h-5 w-5"></div>
          <div className="swap-deco-3 bg-primary absolute left-10 top-10 block h-5 w-5"></div>
          <div className="swap-deco-4 bg-incard top-15 absolute left-5 block h-5 w-5"></div>
          <div className="swap-deco-5 bg-incard absolute left-10 top-20 flex h-10 w-10 flex-row items-center justify-center">
            <ArrowRight size={24} className="shrink-0" />
          </div>
          <div className="swap-deco-6 bg-incard top-35 absolute right-10 block h-5 w-5"></div>
          <div className="swap-deco-7 bg-primary absolute right-0 top-40 block h-10 w-10"></div>
          <div className="swap-deco-8 bg-incard right-15 absolute top-40 block h-5 w-5"></div>
        </div>
        <div className="bg-incard md:h-50 md:w-50 flex aspect-square h-32 flex-col items-center justify-center gap-2 md:aspect-auto">
          <TokenIcon
            token={toToken}
            className="size-10 bg-transparent md:size-14"
            size={56}
          />
          <span
            className="text-center text-xl font-medium md:text-3xl"
            data-testid="buyAmountLabel"
          >
            {formatWithMaxDecimals(toAmount)}
          </span>
          <span
            className="text-muted-foreground"
            data-testid="buyUsdAmountLabel"
          >
            ~$
            {isSell
              ? formatWithMaxDecimals(buyUSDValue)
              : formatWithMaxDecimals(sellUSDValue)}
          </span>
        </div>
      </div>

      <div className="flex w-full flex-col items-start justify-start space-y-2">
        <div className="flex w-full flex-row items-center justify-between">
          <span className="text-muted-foreground">Rate</span>
          <span data-testid="rateLabel">{`${rate && Number(rate) > 0 ? Number(rate).toFixed(4) : "0"} ${tokenInSymbol} ~ 1 ${tokenOutSymbol}`}</span>
        </div>

        <div className="flex w-full flex-row items-center justify-between">
          <span className="text-muted-foreground">Gas Fees</span>
          {isGasEstimating ? (
            <span className="text-muted-foreground">Calculating...</span>
          ) : gasEstimate ? (
            <span data-testid="gasFeesLabel">
              ~{formatWithMaxDecimals(gasEstimate.totalFeeFormatted)} CELO
              {gasEstimate.totalFeeUSD && (
                <span className="text-muted-foreground ml-1">
                  (${formatWithMaxDecimals(gasEstimate.totalFeeUSD)})
                </span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">-</span>
          )}
        </div>

        <div className="flex w-full flex-row items-center justify-between">
          <span className="text-muted-foreground">Slippage</span>
          <span data-testid="slippageLabel">{slippage}%</span>
        </div>
      </div>

      <Button
        data-testid={
          isSwapTxLoading || isSwapTxReceiptLoading
            ? "loadingLabel"
            : "swapButton"
        }
        onClick={onSubmit}
        className="mt-auto w-full"
        size="lg"
        clipped="lg"
        disabled={
          isSwapTxLoading ||
          isSwapTxReceiptLoading ||
          !rate ||
          !amountWei ||
          !address ||
          !isConnected ||
          hasInsufficientReserveBalance ||
          isReserveCheckLoading
        }
      >
        {isSwapTxLoading || isSwapTxReceiptLoading ? <IconLoading /> : "Swap"}
      </Button>
    </div>
  );
}
