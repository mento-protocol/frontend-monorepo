import { BaseError, UserRejectedRequestError } from "viem";

const USER_REJECTION_PATTERNS = [
  /user\s+rejected/i,
  /user\s+denied/i,
  /denied\s+transaction\s+signature/i,
  /rejected\s+by\s+user/i,
  /request\s+rejected/i,
];

/**
 * Detects whether an error represents a user rejecting a wallet action
 * (e.g. declining to sign or switch chains). Checks viem's typed
 * UserRejectedRequestError and the EIP-1193 code 4001 first, then falls
 * back to a message-based check for errors that only expose a string.
 */
export function isUserRejection(error: unknown): boolean {
  if (
    error instanceof BaseError &&
    error.walk((cause) => cause instanceof UserRejectedRequestError)
  ) {
    return true;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === UserRejectedRequestError.code
  ) {
    return true;
  }

  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : String(error ?? "");

  return USER_REJECTION_PATTERNS.some((pattern) => pattern.test(message));
}
