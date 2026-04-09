// Re-export SDK types used by the borrow UI
export type {
  BorrowPosition,
  LoanDetails,
  SystemParams,
  CallParams,
  OpenTroveParams,
  AdjustTroveParams,
  InterestRateBracket,
  TroveStatus,
  RiskLevel,
} from "@mento-protocol/mento-sdk";

// ---------------------------------------------------------------------------
// Frontend-specific types
// ---------------------------------------------------------------------------

export interface DebtTokenConfig {
  symbol: string;
  currencySymbol: string;
  currencyCode: string;
  locale: string;
  collateralSymbol: string;
}

export interface StabilityPoolPosition {
  deposit: bigint;
  collateralGain: bigint;
  debtTokenGain: bigint;
  hasActiveDeposit: boolean;
}

// ---------------------------------------------------------------------------
// Debt token configuration registry
// ---------------------------------------------------------------------------

export const DEBT_TOKEN_CONFIGS: Record<string, DebtTokenConfig> = {
  GBPm: {
    symbol: "GBPm",
    currencySymbol: "£",
    currencyCode: "GBP",
    locale: "en-GB",
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
