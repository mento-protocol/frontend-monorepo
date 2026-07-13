import { isUserRejection } from "@repo/web3/is-user-rejection";

const INSUFFICIENT_FUNDS_PATTERN = /insufficient funds/i;

const INSUFFICIENT_FUNDS_MESSAGE = "Insufficient funds for this transaction.";
const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

type ErrorWithDetails = {
  cause?: unknown;
  details?: unknown;
  message?: unknown;
  shortMessage?: unknown;
};

function extractErrorText(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    const { shortMessage, details, cause } = error as ErrorWithDetails;
    return [error.message, shortMessage, details, extractErrorText(cause)]
      .map((value) => (typeof value === "string" ? value : ""))
      .filter(Boolean)
      .join(" ");
  }

  if (typeof error !== "object" || error === null) {
    return String(error ?? "");
  }

  const { message, shortMessage, details, cause } = error as ErrorWithDetails;

  return [message, shortMessage, details, extractErrorText(cause)]
    .map((value) => (typeof value === "string" ? value : ""))
    .filter(Boolean)
    .join(" ");
}

export function getGovernanceTransactionErrorMessage(
  error: unknown,
): string | null {
  const errorText = extractErrorText(error);

  if (isUserRejection(error) || isUserRejection(errorText)) {
    return null;
  }

  if (INSUFFICIENT_FUNDS_PATTERN.test(errorText)) {
    return INSUFFICIENT_FUNDS_MESSAGE;
  }

  return GENERIC_ERROR_MESSAGE;
}
