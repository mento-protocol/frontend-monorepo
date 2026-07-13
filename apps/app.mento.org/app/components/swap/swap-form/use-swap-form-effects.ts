import type { TokenSymbol } from "@mento-protocol/mento-sdk";
import {
  formatWithMaxDecimals,
  type ChainId,
  type SwapFormValues,
  useTradablePairs,
} from "@repo/web3";
import { useEffect, type RefObject } from "react";
import type { FieldError, UseFormReturn } from "react-hook-form";
import { toast } from "sonner";

import type { LastChangedToken } from "./route-driven-state";
import type { FormValues } from "./types";

export function useSwapQuoteFormEffects({
  amount,
  amountError,
  form,
  formQuote,
  hasAmount,
  quote,
}: {
  amount: string;
  amountError?: FieldError;
  form: UseFormReturn<FormValues>;
  formQuote: string;
  hasAmount: boolean;
  quote?: string;
}) {
  useEffect(() => {
    if (quote !== undefined) {
      const formattedQuote = formatWithMaxDecimals(quote, 4, false);
      if (formQuote !== formattedQuote) {
        form.setValue("quote", formattedQuote, { shouldValidate: true });
      }
    }
  }, [quote, form, formQuote]);

  useEffect(() => {
    if (
      amountError?.message &&
      amountError.message !== "Invalid input" &&
      amountError.message !== "Amount is required" &&
      hasAmount
    ) {
      toast.error(amountError.message);
    }
  }, [amountError, hasAmount, amount]);
}

export function useSwapTokenPairEffects({
  chainId,
  form,
  formValues,
  lastChangedTokenRef,
  selectedTokenInSymbol,
  selectedTokenOutSymbol,
  setLastChangedToken,
}: {
  chainId: ChainId;
  form: UseFormReturn<FormValues>;
  formValues: SwapFormValues | null;
  lastChangedTokenRef: RefObject<LastChangedToken>;
  selectedTokenInSymbol?: TokenSymbol;
  selectedTokenOutSymbol?: TokenSymbol;
  setLastChangedToken: (value: LastChangedToken) => void;
}) {
  const {
    data: fromTokenTradablePairs,
    isLoading: isFromTokenTradablePairsLoading,
  } = useTradablePairs(selectedTokenInSymbol, chainId);
  const {
    data: toTokenTradablePairs,
    isLoading: isToTokenTradablePairsLoading,
  } = useTradablePairs(selectedTokenOutSymbol, chainId);

  // Reset form fields after a successful swap (formValues.amount is cleared but tokens preserved)
  useEffect(() => {
    if (!formValues?.amount && formValues?.tokenInSymbol) {
      setLastChangedToken(null);
      form.reset({
        amount: "",
        quote: "",
        tokenInSymbol: formValues.tokenInSymbol,
        tokenOutSymbol: formValues.tokenOutSymbol || "USDm",
        slippage: formValues?.slippage || "0.3",
      });
    }
  }, [
    formValues?.amount,
    formValues?.tokenInSymbol,
    formValues?.tokenOutSymbol,
    formValues?.slippage,
    form,
    setLastChangedToken,
  ]);

  useEffect(() => {
    const lastChangedToken = lastChangedTokenRef.current;

    if (!selectedTokenInSymbol || !selectedTokenOutSymbol || !lastChangedToken)
      return;
    if (isFromTokenTradablePairsLoading || isToTokenTradablePairsLoading)
      return;
    if (!fromTokenTradablePairs || !toTokenTradablePairs) return;

    const isValidPair =
      fromTokenTradablePairs.includes(selectedTokenOutSymbol) ||
      toTokenTradablePairs.includes(selectedTokenInSymbol);

    if (!isValidPair) {
      if (lastChangedToken === "from") {
        form.setValue("tokenOutSymbol", "", { shouldValidate: false });
      } else if (lastChangedToken === "to") {
        form.setValue("tokenInSymbol", "", { shouldValidate: false });
      }
      setLastChangedToken(null);
    }
  }, [
    selectedTokenInSymbol,
    selectedTokenOutSymbol,
    fromTokenTradablePairs,
    toTokenTradablePairs,
    isFromTokenTradablePairsLoading,
    isToTokenTradablePairsLoading,
    form,
    lastChangedTokenRef,
    setLastChangedToken,
  ]);
}
