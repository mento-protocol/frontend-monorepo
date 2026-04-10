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

// DebtTokenConfig and its registry live in borrow-server.ts (no client deps)
// so they can be imported by both server components and client code.
export type { DebtTokenConfig } from "../../borrow-server";
export { DEBT_TOKEN_CONFIGS, getDebtTokenConfig } from "../../borrow-server";

export interface StabilityPoolPosition {
  deposit: bigint;
  collateralGain: bigint;
  debtTokenGain: bigint;
  hasActiveDeposit: boolean;
}
