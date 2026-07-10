import { getGovernanceTransactionErrorMessage } from "./get-governance-transaction-error-message";

const GOVERNANCE_TRANSACTION_ERROR_LABELS = {
  execute: "Error executing proposal",
  queue: "Error queueing proposal",
  cancel: "Error cancelling proposal",
  vote: "Error submitting vote",
} as const;

type GovernanceTransactionErrorKind =
  keyof typeof GOVERNANCE_TRANSACTION_ERROR_LABELS;

interface GovernanceTransactionErrorCandidate {
  kind: GovernanceTransactionErrorKind;
  error: unknown;
}

interface ActiveGovernanceTransactionError {
  label: string;
  message: string;
}

export function getActiveGovernanceTransactionError(
  candidates: readonly GovernanceTransactionErrorCandidate[],
): ActiveGovernanceTransactionError | null {
  for (const candidate of candidates) {
    if (!candidate.error) {
      continue;
    }

    const message = getGovernanceTransactionErrorMessage(candidate.error);

    if (message === null) {
      continue;
    }

    return {
      label: GOVERNANCE_TRANSACTION_ERROR_LABELS[candidate.kind],
      message,
    };
  }

  return null;
}
