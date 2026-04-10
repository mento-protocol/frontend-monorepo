export interface DebtTokenConfig {
  symbol: string;
  currencySymbol: string;
  currencyCode: string;
  locale: string;
  collateralSymbol: string;
}

export const DEBT_TOKEN_CONFIGS: Record<string, DebtTokenConfig> = {
  GBPm: {
    symbol: "GBPm",
    currencySymbol: "£",
    currencyCode: "GBP",
    locale: "en-GB",
    collateralSymbol: "USDm",
  },
};

export function getDebtTokenConfig(symbol: string): DebtTokenConfig {
  return (
    DEBT_TOKEN_CONFIGS[symbol] ?? {
      symbol,
      currencySymbol: symbol,
      currencyCode: symbol.replace(/m$/, ""),
      locale: "en-US",
      collateralSymbol: "USDm",
    }
  );
}
