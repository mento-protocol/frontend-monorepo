import type { TokenSymbol } from "@mento-protocol/mento-sdk";

export function getAvailableTokenSymbol(
  value: string | undefined,
  availableTokens: TokenSymbol[],
): TokenSymbol | undefined {
  if (!value) return undefined;
  return availableTokens.find((token) => token === value);
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
