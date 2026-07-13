import type { TokenSymbol } from "@mento-protocol/mento-sdk";

import { getAvailableTokenSymbol } from "./token-selection";

type ClearAmountOnlyPlan = {
  kind: "clear-amount-only";
};

type ResetTokensPlan = {
  kind: "reset-tokens";
  tokenInSymbol: TokenSymbol | "";
  tokenOutSymbol: TokenSymbol | "";
};

export type ChainChangeSyncPlan = ClearAmountOnlyPlan | ResetTokensPlan;

interface GetChainChangeSyncPlanOptions {
  availableTokens: TokenSymbol[];
  currentTokenInSymbol: string | undefined;
  currentTokenOutSymbol: string | undefined;
  preferredQuoteTokenSymbol: TokenSymbol | null | undefined;
}

export function getChainChangeSyncPlan({
  availableTokens,
  currentTokenInSymbol,
  currentTokenOutSymbol,
  preferredQuoteTokenSymbol,
}: GetChainChangeSyncPlanOptions): ChainChangeSyncPlan {
  const resolvedTokenIn = getAvailableTokenSymbol(
    currentTokenInSymbol,
    availableTokens,
  );
  const resolvedTokenOut = getAvailableTokenSymbol(
    currentTokenOutSymbol,
    availableTokens,
  );

  if (
    resolvedTokenIn &&
    resolvedTokenOut &&
    resolvedTokenIn !== resolvedTokenOut
  ) {
    return { kind: "clear-amount-only" };
  }

  const tokenInSymbol =
    resolvedTokenIn ?? preferredQuoteTokenSymbol ?? availableTokens[0] ?? "";

  let tokenOutSymbol: TokenSymbol | "" = resolvedTokenOut ?? "";
  if (tokenInSymbol && tokenOutSymbol && tokenInSymbol === tokenOutSymbol) {
    tokenOutSymbol = "";
  }

  if (!tokenOutSymbol && availableTokens.length > 1) {
    const fallbackTokenOut =
      availableTokens.find((token) => token !== tokenInSymbol) ?? "";
    tokenOutSymbol = fallbackTokenOut;
  }

  return {
    kind: "reset-tokens",
    tokenInSymbol,
    tokenOutSymbol,
  };
}
