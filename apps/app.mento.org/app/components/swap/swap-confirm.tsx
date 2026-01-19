"use client";

import { TokenSymbol } from "@mento-protocol/mento-sdk";
import { Button, IconLoading, TokenIcon } from "@repo/ui";
import {
  formatWithMaxDecimals,
  formValuesAtom,
  getMinBuyAmount,
  logger,
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

export function SwapConfirm() {
  const [formValues] = useAtom(formValuesAtom);

  const { address, isConnected } = useAccount();
  const chainId = useChainId();

  const amount = String(formValues?.amount || "");
  const tokenInSymbol = formValues?.tokenInSymbol || TokenSymbol.USDm;
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
  } = useOptimizedSwapQuote(amount, tokenInSymbol, tokenOutSymbol);

  // Always direction "in" - selling exact amount of fromToken (swapIn)
  const swapValues = useMemo(() => {
    const computedFromAmountWei = amountWei;
    // Minimum amount of toToken we're willing to receive
    const computedThresholdAmountWei = getMinBuyAmount(
      quoteWei,
      slippage,
    ).toFixed(0);

    return {
      fromAmount: amount,
      fromAmountWei: computedFromAmountWei,
      toAmount: quote,
      toAmountWei: quoteWei,
      thresholdAmountInWei: computedThresholdAmountWei,
    };
  }, [amount, amountWei, quote, quoteWei, slippage]);

  const { fromAmount, fromAmountWei, toAmount, thresholdAmountInWei } =
    swapValues;

  const { sendSwapTx, isSwapTxLoading, isSwapTxReceiptLoading } =
    useSwapTransaction(
      chainId,
      tokenInSymbol,
      tokenOutSymbol,
      fromAmountWei,
      thresholdAmountInWei,
      address,
      true,
      {
        fromAmount,
        toAmount,
      },
    );

  const approveAmount = amountWei;

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
    address: address || "",
    chainId,
    slippage,
    skipApprove,
  });

  // Calculate sell USD value with fallback
  const sellUSDValue = useMemo(() => {
    // First check if we have a value from formValues
    const passedValue = formValues?.sellUSDValue;
    if (passedValue && passedValue !== "0") {
      return passedValue;
    }

    // Fallback to calculating it ourselves selling from-token
    return tokenInSymbol === "USDm" ? amount || "0" : fromTokenUSDValue || "0";
  }, [formValues?.sellUSDValue, tokenInSymbol, amount, fromTokenUSDValue]);

  // Calculate buy USD value with fallback
  const buyUSDValue = useMemo(() => {
    // First check if we have a value from formValues
    const passedValue = formValues?.buyUSDValue;
    if (passedValue && passedValue !== "0") {
      return passedValue;
    }

    // Fallback to calculating it ourselves - buying to-token
    return tokenOutSymbol === "USDm" ? quote || "0" : toTokenUSDValue || "0";
  }, [formValues?.buyUSDValue, tokenOutSymbol, quote, toTokenUSDValue]);

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

  return (
    <div className="gap-6 flex h-full flex-col">
      <div className="md:w-[520px] flex w-full flex-row items-center justify-between">
        <div className="md:h-50 md:w-50 h-32 gap-2 md:aspect-auto flex aspect-square flex-col items-center justify-center bg-incard">
          <TokenIcon
            token={fromToken}
            className="h-10 w-10 md:h-14 md:w-14 bg-transparent"
            size={56}
          />
          <span
            className="text-xl font-medium md:text-3xl text-center"
            data-testid="sellAmountLabel"
          >
            {formatWithMaxDecimals(fromAmount)}
          </span>
          <span
            className="text-sm md:text-base text-muted-foreground"
            data-testid="sellUsdAmountLabel"
          >
            ~${formatWithMaxDecimals(sellUSDValue)}
          </span>
        </div>
        <div className="md:w-30 p-0 md:flex relative hidden h-full items-center justify-center text-muted-foreground">
          <div className="swap-deco-1 left-0 top-0 h-10 w-10 absolute block bg-incard"></div>
          <div className="swap-deco-2 left-15 top-5 h-5 w-5 absolute block bg-incard"></div>
          <div className="swap-deco-3 left-10 top-10 h-5 w-5 absolute block bg-primary"></div>
          <div className="swap-deco-4 top-15 left-5 h-5 w-5 absolute block bg-incard"></div>
          <div className="swap-deco-5 left-10 top-20 h-10 w-10 absolute flex flex-row items-center justify-center bg-incard">
            <ArrowRight size={24} className="shrink-0" />
          </div>
          <div className="swap-deco-6 top-35 right-10 h-5 w-5 absolute block bg-incard"></div>
          <div className="swap-deco-7 right-0 top-40 h-10 w-10 absolute block bg-primary"></div>
          <div className="swap-deco-8 right-15 top-40 h-5 w-5 absolute block bg-incard"></div>
        </div>
        <div className="md:h-50 md:w-50 h-32 gap-2 md:aspect-auto flex aspect-square flex-col items-center justify-center bg-incard">
          <TokenIcon
            token={toToken}
            className="size-10 md:size-14 bg-transparent"
            size={56}
          />
          <span
            className="text-xl font-medium md:text-3xl text-center"
            data-testid="buyAmountLabel"
          >
            {formatWithMaxDecimals(toAmount)}
          </span>
          <span
            className="text-muted-foreground"
            data-testid="buyUsdAmountLabel"
          >
            ~${formatWithMaxDecimals(buyUSDValue)}
          </span>
        </div>
      </div>

      <div className="space-y-2 flex w-full flex-col items-start justify-start">
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
                <span className="ml-1 text-muted-foreground">
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
          !isConnected
        }
      >
        {isSwapTxLoading || isSwapTxReceiptLoading ? <IconLoading /> : "Swap"}
      </Button>
    </div>
  );
}
