// Server-safe borrow configuration — no "use client" dependencies.
// This is the single source of truth for DebtTokenConfig and the debt-token
// registry. Both the app's server-side route utilities and the client-side
// borrow features import from here to avoid drift.

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
  CHFm: {
    symbol: "CHFm",
    currencySymbol: "₣",
    currencyCode: "CHF",
    locale: "de-CH",
    collateralSymbol: "USDm",
  },
  JPYm: {
    symbol: "JPYm",
    currencySymbol: "¥",
    currencyCode: "JPY",
    locale: "ja-JP",
    collateralSymbol: "USDm",
  },
} as const;

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
