import { atomWithStorage } from "jotai/utils";

// ---------------------------------------------------------------------------
// Flow step — represents one transaction in a multi-step flow
// ---------------------------------------------------------------------------

export interface FlowStep {
  id: string;
  label: string;
  status: "idle" | "pending" | "confirming" | "confirmed" | "error";
  txHash?: string;
  error?: { name: string | null; message: string };
}

// ---------------------------------------------------------------------------
// Flow state — tracks the entire multi-step transaction flow
// ---------------------------------------------------------------------------

export interface BorrowFlowState {
  flowId: string;
  operation: string;
  steps: FlowStep[];
  currentStepIndex: number;
  account: string;
}

// ---------------------------------------------------------------------------
// Atom — persisted to localStorage so flow survives page refresh
// ---------------------------------------------------------------------------

export const borrowFlowAtom = atomWithStorage<BorrowFlowState | null>(
  "mento:borrow:flow",
  null,
);
