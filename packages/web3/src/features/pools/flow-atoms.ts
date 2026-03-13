import { atom } from "jotai";

// ---------------------------------------------------------------------------
// Flow step — represents one transaction in a multi-step liquidity flow
// ---------------------------------------------------------------------------

export interface LiquidityFlowStep {
  id: string;
  label: string;
  status: "idle" | "pending" | "confirming" | "confirmed" | "error";
  txHash?: string;
  error?: { message: string };
}

// ---------------------------------------------------------------------------
// Flow state — tracks the entire multi-step transaction flow
// ---------------------------------------------------------------------------

export interface LiquidityFlowState {
  operation: string;
  steps: LiquidityFlowStep[];
  currentStepIndex: number;
  chainId?: number;
}

// ---------------------------------------------------------------------------
// Atom — in-memory only (no persistence needed for liquidity flows)
// ---------------------------------------------------------------------------

export const liquidityFlowAtom = atom<LiquidityFlowState | null>(null);
