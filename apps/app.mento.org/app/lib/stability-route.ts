export const STABILITY_CHAIN_ID = 42220;
export const STABILITY_CHAIN_NAME = "Celo";
const STABILITY_CHAIN_SLUG = "celo";

const STABILITY_DEBT_TOKENS = [
  {
    symbol: "GBPm",
    currencySymbol: "£",
    currencyCode: "GBP",
    locale: "en-GB",
  },
] as const;

export function resolveStabilityChainId(chainSlug: string): number | undefined {
  return chainSlug.toLowerCase() === STABILITY_CHAIN_SLUG
    ? STABILITY_CHAIN_ID
    : undefined;
}

export function resolveStabilityDebtToken(
  tokenSlug: string,
): (typeof STABILITY_DEBT_TOKENS)[number] | undefined {
  return STABILITY_DEBT_TOKENS.find(
    (token) => token.symbol.toLowerCase() === tokenSlug.toLowerCase(),
  );
}

export const DEFAULT_STABILITY_TOKEN = STABILITY_DEBT_TOKENS[0];

export function getStabilityRoute(symbol: string): string {
  return `/earn/stability/${STABILITY_CHAIN_SLUG}/${symbol.toLowerCase()}`;
}

export function getStabilitySwapRoute(symbol: string): string {
  const params = new URLSearchParams({
    from: "USDm",
    to: symbol,
  });

  return `/swap/${STABILITY_CHAIN_SLUG}?${params.toString()}`;
}
