import type { TokenSymbol } from "@mento-protocol/mento-sdk";

export function getAvailableTokenSymbol(
  value: string | undefined,
  availableTokens: TokenSymbol[],
): TokenSymbol | undefined {
  if (!value) return undefined;
  return availableTokens.find((token) => token === value);
}

export function getDefaultTokenInSymbol(
  preferredQuoteToken: TokenSymbol | null | undefined,
  availableTokens: TokenSymbol[],
): TokenSymbol | undefined {
  if (
    preferredQuoteToken &&
    getAvailableTokenSymbol(preferredQuoteToken, availableTokens)
  ) {
    return preferredQuoteToken;
  }

  return availableTokens[0];
}

export function getSelectedTokenSymbol(
  watchedValue: string | undefined,
  fallbackValue: string | undefined,
  availableTokens: TokenSymbol[],
): TokenSymbol | undefined {
  if (typeof watchedValue === "undefined") {
    return getAvailableTokenSymbol(fallbackValue, availableTokens);
  }

  return getAvailableTokenSymbol(watchedValue, availableTokens);
}
