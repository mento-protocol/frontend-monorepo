import type { TokenSymbol } from "@mento-protocol/mento-sdk";
import {
  TRADING_LIMITS_UNAVAILABLE_MESSAGE,
  getTokenDecimals,
  parseAmount,
  toWei,
  type ChainId,
} from "@repo/web3";
import {
  useEffect,
  useMemo,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { toast } from "sonner";

import { checkTradingLimitViolation } from "./trading-limits";
import {
  createWaitingForQuoteStore,
  getTokenPairKey,
} from "./waiting-for-quote-store";

type TradingLimits = Parameters<typeof checkTradingLimitViolation>[0]["limits"];

export function useSwapQuoteState({
  amount,
  canQuote,
  chainId,
  formQuote,
  fromTokenUSDValue,
  hasAmount,
  isQuoteError,
  isTradingSuspended,
  limits,
  limitsError,
  limitsLoading,
  prevTradingSuspensionErrorRef,
  quote,
  quoteFetching,
  routeAmounts,
  selectedTokenInSymbol,
  selectedTokenOutSymbol,
  suspensionToastIdRef,
  toTokenUSDValue,
  tokenInSymbol,
  tokenOutSymbol,
  tradingSuspensionError,
}: {
  amount: string;
  canQuote: boolean;
  chainId: ChainId;
  formQuote: string;
  fromTokenUSDValue?: string;
  hasAmount: boolean;
  isQuoteError: boolean;
  isTradingSuspended: boolean;
  limits?: TradingLimits | null;
  limitsError: boolean;
  limitsLoading: boolean;
  prevTradingSuspensionErrorRef: RefObject<string | null>;
  quote?: string;
  quoteFetching: boolean;
  routeAmounts: string[];
  selectedTokenInSymbol?: TokenSymbol;
  selectedTokenOutSymbol?: TokenSymbol;
  suspensionToastIdRef: RefObject<string | number | null>;
  toTokenUSDValue?: string;
  tokenInSymbol: string;
  tokenOutSymbol: string;
  tradingSuspensionError: string | null;
}) {
  const tradingLimitError = useMemo(() => {
    if (hasAmount && limitsError) return TRADING_LIMITS_UNAVAILABLE_MESSAGE;
    if (!hasAmount || !limits || limitsLoading) return null;
    if (routeAmounts.length === 0) {
      return quoteFetching ? null : TRADING_LIMITS_UNAVAILABLE_MESSAGE;
    }
    return checkTradingLimitViolation({
      limits,
      routeAmounts,
    });
  }, [
    limits,
    limitsError,
    limitsLoading,
    quoteFetching,
    routeAmounts,
    hasAmount,
  ]);

  useEffect(() => {
    if (tradingLimitError) {
      toast.error(tradingLimitError, { duration: 20000 });
    }
  }, [tradingLimitError]);

  useEffect(() => {
    const prevError = prevTradingSuspensionErrorRef.current;
    const hasError = tradingSuspensionError !== null;
    const errorChanged = prevError !== tradingSuspensionError;

    if (hasError && errorChanged) {
      if (suspensionToastIdRef.current) {
        toast.dismiss(suspensionToastIdRef.current);
      }
      suspensionToastIdRef.current = toast.error(tradingSuspensionError, {
        duration: 20000,
      });
    } else if (prevError !== null && !hasError) {
      if (suspensionToastIdRef.current) {
        toast.dismiss(suspensionToastIdRef.current);
        suspensionToastIdRef.current = null;
      }
    }

    prevTradingSuspensionErrorRef.current = tradingSuspensionError;
  }, [
    prevTradingSuspensionErrorRef,
    suspensionToastIdRef,
    tradingSuspensionError,
  ]);

  const isLoading =
    quoteFetching && canQuote && !tradingLimitError && !limitsLoading;
  const waitingForQuotePairStore = useMemo(
    () => createWaitingForQuoteStore(),
    [],
  );
  const waitingForQuotePair = useSyncExternalStore(
    waitingForQuotePairStore.subscribe,
    waitingForQuotePairStore.getSnapshot,
    waitingForQuotePairStore.getSnapshot,
  );
  const tokenPairKey = getTokenPairKey({
    tokenInSymbol: selectedTokenInSymbol,
    tokenOutSymbol: selectedTokenOutSymbol,
  });

  useEffect(() => {
    waitingForQuotePairStore.update({
      hasAmount,
      isTradingSuspended,
      quote,
      quoteFetching,
      tokenInSymbol: selectedTokenInSymbol,
      tokenOutSymbol: selectedTokenOutSymbol,
    });
  }, [
    hasAmount,
    isTradingSuspended,
    quote,
    quoteFetching,
    selectedTokenInSymbol,
    selectedTokenOutSymbol,
    waitingForQuotePairStore,
  ]);

  const isWaitingForQuote =
    tokenPairKey !== null && waitingForQuotePair === tokenPairKey;
  const isButtonLoading = useMemo(
    () =>
      !isTradingSuspended &&
      !isQuoteError &&
      !tradingLimitError &&
      !limitsLoading &&
      (quoteFetching || isWaitingForQuote) &&
      hasAmount &&
      !!selectedTokenInSymbol &&
      !!selectedTokenOutSymbol,
    [
      quoteFetching,
      isWaitingForQuote,
      hasAmount,
      selectedTokenInSymbol,
      selectedTokenOutSymbol,
      isTradingSuspended,
      isQuoteError,
      tradingLimitError,
      limitsLoading,
    ],
  );
  const sellUSDValue = useMemo(
    () => (tokenInSymbol === "USDm" ? amount || "0" : fromTokenUSDValue || "0"),
    [tokenInSymbol, amount, fromTokenUSDValue],
  );
  const buyUSDValue = useMemo(
    () =>
      tokenOutSymbol === "USDm" ? formQuote || "0" : toTokenUSDValue || "0",
    [tokenOutSymbol, formQuote, toTokenUSDValue],
  );
  const amountInWei = useMemo(() => {
    if (!selectedTokenInSymbol) return "0";
    const parsedAmount = parseAmount(amount);
    if (!parsedAmount || !parsedAmount.gt(0)) return "0";
    return toWei(
      parsedAmount,
      getTokenDecimals(selectedTokenInSymbol, chainId),
    ).toFixed(0);
  }, [amount, selectedTokenInSymbol, chainId]);

  return {
    amountInWei,
    buyUSDValue,
    isButtonLoading,
    isLoading,
    sellUSDValue,
    tradingLimitError,
  };
}
