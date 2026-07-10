import type { TokenSymbol } from "@mento-protocol/mento-sdk";

import { createLocalStore } from "@/lib/utils/local-store";

type TokenPairSelection = {
  tokenInSymbol: TokenSymbol | undefined;
  tokenOutSymbol: TokenSymbol | undefined;
};

type WaitingForQuoteState = {
  nextPreviousTokenPair: TokenPairSelection;
  nextWaitingForQuotePair: string | null;
};

export type WaitingForQuoteUpdate = TokenPairSelection & {
  hasAmount: boolean;
  isTradingSuspended: boolean;
  quote: string | null | undefined;
  quoteFetching: boolean;
};

export function getTokenPairKey({
  tokenInSymbol,
  tokenOutSymbol,
}: TokenPairSelection): string | null {
  if (!tokenInSymbol || !tokenOutSymbol) return null;
  return `${tokenInSymbol}:${tokenOutSymbol}`;
}

function hasValidQuote(
  quote: string | null | undefined,
  quoteFetching: boolean,
): boolean {
  return Boolean(quote && quote !== "0" && Number(quote) > 0 && !quoteFetching);
}

export function getWaitingForQuoteTransition(
  previousTokenPair: TokenPairSelection,
  currentWaitingForQuotePair: string | null,
  update: WaitingForQuoteUpdate,
): WaitingForQuoteState {
  const currentTokenPair = {
    tokenInSymbol: update.tokenInSymbol,
    tokenOutSymbol: update.tokenOutSymbol,
  };
  const tokenPairKey = getTokenPairKey(currentTokenPair);
  const tokensChanged =
    previousTokenPair.tokenInSymbol !== update.tokenInSymbol ||
    previousTokenPair.tokenOutSymbol !== update.tokenOutSymbol;

  if (tokensChanged) {
    return {
      nextPreviousTokenPair: currentTokenPair,
      nextWaitingForQuotePair:
        update.hasAmount && tokenPairKey ? tokenPairKey : null,
    };
  }

  const shouldClearWaiting =
    !update.hasAmount ||
    !tokenPairKey ||
    update.isTradingSuspended ||
    (currentWaitingForQuotePair === tokenPairKey &&
      hasValidQuote(update.quote, update.quoteFetching));

  if (shouldClearWaiting) {
    return {
      nextPreviousTokenPair: previousTokenPair,
      nextWaitingForQuotePair: null,
    };
  }

  return {
    nextPreviousTokenPair: previousTokenPair,
    nextWaitingForQuotePair: currentWaitingForQuotePair,
  };
}

export function createWaitingForQuoteStore() {
  const store = createLocalStore<string | null>(null);
  let previousTokenPair: TokenPairSelection = {
    tokenInSymbol: undefined,
    tokenOutSymbol: undefined,
  };

  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    update: (update: WaitingForQuoteUpdate) => {
      const transition = getWaitingForQuoteTransition(
        previousTokenPair,
        store.getSnapshot(),
        update,
      );

      previousTokenPair = transition.nextPreviousTokenPair;
      store.set(transition.nextWaitingForQuotePair);
    },
  };
}
