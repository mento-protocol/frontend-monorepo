import { parseAmount, type ChainId, type SwapFormValues } from "@repo/web3";
import type { TokenSymbol } from "@mento-protocol/mento-sdk";
import { useMemo } from "react";

import {
  getAvailableTokenSymbol,
  getDefaultTokenInSymbol,
} from "./token-selection";
import type { RouteDrivenFormState } from "./route-driven-state";
import type { FormValues } from "./types";

export interface SwapFormRouteOptions {
  initialFrom?: string;
  initialTo?: string;
  initialAmount?: string;
  urlChainId?: ChainId;
}

export interface SwapFormInitialState {
  defaultValues: FormValues;
  initialTokenInSymbol: string;
  initialTokenOutSymbol: string;
  routeDrivenFormState: RouteDrivenFormState;
}

export function sanitizeRouteAmount(value?: string): string {
  if (!value) return "";
  const trimmedValue = value.trim();
  if (!trimmedValue) return "";
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(trimmedValue)) return "";

  const parsedValue = parseAmount(trimmedValue);
  if (!parsedValue || parsedValue.isNegative()) return "";

  return trimmedValue;
}

export function getSwapFormInitialState({
  formValues,
  options,
  availableTokens,
  preferredQuoteTokenSymbol,
}: {
  formValues: SwapFormValues | null;
  options?: SwapFormRouteOptions;
  availableTokens: TokenSymbol[];
  preferredQuoteTokenSymbol?: TokenSymbol | null;
}): SwapFormInitialState {
  const hasUrlParams = Boolean(
    options?.initialFrom || options?.initialTo || options?.initialAmount,
  );
  const validatedInitialFrom = getAvailableTokenSymbol(
    options?.initialFrom,
    availableTokens,
  );
  const validatedInitialTo = getAvailableTokenSymbol(
    options?.initialTo,
    availableTokens,
  );
  const storedTokenInSymbol =
    !hasUrlParams && formValues?.tokenInSymbol
      ? getAvailableTokenSymbol(formValues.tokenInSymbol, availableTokens)
      : undefined;
  const storedTokenOutSymbol =
    !hasUrlParams && formValues?.tokenOutSymbol
      ? getAvailableTokenSymbol(formValues.tokenOutSymbol, availableTokens)
      : undefined;
  const defaultTokenInSymbol =
    getDefaultTokenInSymbol(preferredQuoteTokenSymbol, availableTokens) ?? "";
  const initialTokenInSymbol =
    validatedInitialFrom || storedTokenInSymbol || defaultTokenInSymbol;
  const requestedTokenOut = validatedInitialTo || storedTokenOutSymbol;
  const initialTokenOutSymbol =
    requestedTokenOut && requestedTokenOut !== initialTokenInSymbol
      ? requestedTokenOut
      : availableTokens.find((token) => token !== initialTokenInSymbol) || "";
  const sanitizedInitialAmount = sanitizeRouteAmount(options?.initialAmount);
  const hasRequestedRouteTokens = Boolean(
    options?.initialFrom || options?.initialTo,
  );
  const routeUsesRequestedTokens =
    (!options?.initialFrom || validatedInitialFrom === initialTokenInSymbol) &&
    (!options?.initialTo || validatedInitialTo === initialTokenOutSymbol);
  const canReuseStoredDraft =
    !hasUrlParams &&
    storedTokenInSymbol === initialTokenInSymbol &&
    storedTokenOutSymbol === initialTokenOutSymbol;
  const amount = hasUrlParams
    ? !hasRequestedRouteTokens || routeUsesRequestedTokens
      ? sanitizedInitialAmount
      : ""
    : canReuseStoredDraft
      ? formValues?.amount || ""
      : "";
  const quote = canReuseStoredDraft ? formValues?.quote || "" : "";
  const shouldUseDefaultRouteTokens = !hasRequestedRouteTokens;
  const tokenInSymbol = options?.initialFrom
    ? initialTokenInSymbol
    : shouldUseDefaultRouteTokens
      ? initialTokenInSymbol
      : "";
  const tokenOutSymbol = options?.initialTo
    ? initialTokenOutSymbol
    : shouldUseDefaultRouteTokens
      ? initialTokenOutSymbol
      : "";

  return {
    defaultValues: {
      amount,
      quote,
      tokenInSymbol,
      tokenOutSymbol,
      slippage: formValues?.slippage || "0.3",
    },
    initialTokenInSymbol,
    initialTokenOutSymbol,
    routeDrivenFormState: { amount, tokenInSymbol, tokenOutSymbol },
  };
}

export function useStableRouteDrivenFormState(
  amount: string,
  tokenInSymbol: string,
  tokenOutSymbol: string,
): RouteDrivenFormState {
  return useMemo(
    () => ({ amount, tokenInSymbol, tokenOutSymbol }),
    [amount, tokenInSymbol, tokenOutSymbol],
  );
}
