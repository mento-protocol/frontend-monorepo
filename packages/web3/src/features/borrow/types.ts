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
}

export type BorrowView =
  | "dashboard"
  | "open-trove"
  | { view: "manage-trove"; troveId: string }
  | "redeem";

export interface StabilityPoolPosition {
  deposit: bigint;
  collateralGain: bigint;
  debtTokenGain: bigint;
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
  },
} as const;
