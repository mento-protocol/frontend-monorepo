import { useSwapUrlSync } from "@/hooks/use-swap-url-sync";
import {
  getPreferredUsdQuoteTokenSymbol,
  getTokenOptionsByChainId,
  type ChainId,
  type SwapFormValues,
} from "@repo/web3";
import {
  useEffect,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { UseFormReturn } from "react-hook-form";

import { getChainChangeSyncPlan } from "./chain-change-sync";
import {
  getRouteDrivenFormStateSyncPlan,
  type LastChangedToken,
  type RouteDrivenFormState,
} from "./route-driven-state";
import { getAvailableTokenSymbol } from "./token-selection";
import type { FormValues } from "./types";

export function useSwapFormSync({
  amount,
  form,
  formChainId,
  formValues,
  isQuoteError,
  lastRouteDrivenFormStateRef,
  prevChainIdRef,
  routeDrivenFormState,
  setConfirmView,
  setFormValues,
  setLastChangedToken,
  tokenInSymbol,
  tokenOutSymbol,
}: {
  amount: string;
  form: UseFormReturn<FormValues>;
  formChainId: ChainId;
  formValues: SwapFormValues | null;
  isQuoteError: boolean;
  lastRouteDrivenFormStateRef: RefObject<RouteDrivenFormState | null>;
  prevChainIdRef: RefObject<number>;
  routeDrivenFormState: RouteDrivenFormState;
  setConfirmView: Dispatch<SetStateAction<boolean>>;
  setFormValues: Dispatch<SetStateAction<SwapFormValues | null>>;
  setLastChangedToken: (value: LastChangedToken) => void;
  tokenInSymbol: string;
  tokenOutSymbol: string;
}): void {
  useEffect(() => {
    if (prevChainIdRef.current === formChainId) return;
    prevChainIdRef.current = formChainId;

    const availableTokens = getTokenOptionsByChainId(formChainId);
    const plan = getChainChangeSyncPlan({
      availableTokens,
      currentTokenInSymbol: form.getValues("tokenInSymbol"),
      currentTokenOutSymbol: form.getValues("tokenOutSymbol"),
      preferredQuoteTokenSymbol: getPreferredUsdQuoteTokenSymbol(formChainId),
    });

    if (plan.kind === "clear-amount-only") {
      form.setValue("amount", "");
      form.setValue("quote", "");
      setFormValues((prev) => (prev ? { ...prev, amount: "" } : prev));
      return;
    }

    form.setValue("tokenInSymbol", plan.tokenInSymbol);
    form.setValue("tokenOutSymbol", plan.tokenOutSymbol);
    form.setValue("amount", "");
    form.setValue("quote", "");
    setFormValues((prev) =>
      prev
        ? {
            ...prev,
            tokenInSymbol: getAvailableTokenSymbol(
              plan.tokenInSymbol,
              availableTokens,
            ),
            tokenOutSymbol: getAvailableTokenSymbol(
              plan.tokenOutSymbol,
              availableTokens,
            ),
            amount: "",
          }
        : prev,
    );
    setLastChangedToken(null);
  }, [form, formChainId, prevChainIdRef, setFormValues, setLastChangedToken]);

  useEffect(() => {
    const previousRouteState = lastRouteDrivenFormStateRef.current;
    lastRouteDrivenFormStateRef.current = routeDrivenFormState;
    const plan = getRouteDrivenFormStateSyncPlan({
      currentValues: form.getValues(),
      formValuesSlippage: formValues?.slippage,
      previousRouteState,
      routeDrivenFormState,
    });

    if (!plan.shouldReset) return;
    form.reset(plan.resetValues);
    setLastChangedToken(plan.routeChangedTokenSide);
  }, [
    form,
    formValues?.slippage,
    lastRouteDrivenFormStateRef,
    routeDrivenFormState,
    setLastChangedToken,
  ]);

  useSwapUrlSync({
    amount,
    tokenInSymbol,
    tokenOutSymbol,
    urlChainId: formChainId,
  });

  useEffect(() => {
    if (isQuoteError) setConfirmView(false);
  }, [isQuoteError, setConfirmView]);
}
