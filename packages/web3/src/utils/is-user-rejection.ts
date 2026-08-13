const USER_REJECTED_REQUEST_CODE = 4001;
const USER_REJECTED_REQUEST_ERROR_NAME = "UserRejectedRequestError";

const UNAMBIGUOUS_USER_REJECTION_PATTERNS = [
  /user\s+rejected/i,
  /user\s+denied/i,
  /denied\s+transaction\s+signature/i,
  /rejected\s+by\s+user/i,
] as const;

const USER_REJECTION_PATTERNS = [
  ...UNAMBIGUOUS_USER_REJECTION_PATTERNS,
  /request\s+rejected/i,
] as const;

function isUserRejectionWithPatterns(
  error: unknown,
  patterns: readonly RegExp[],
  seen = new Set<object>(),
): boolean {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "";

  if (patterns.some((pattern) => pattern.test(message))) {
    return true;
  }

  if (typeof error !== "object" || error === null || seen.has(error)) {
    return false;
  }

  seen.add(error);
  const candidate = error as {
    cause?: unknown;
    code?: unknown;
    name?: unknown;
  };

  if (
    candidate.code === USER_REJECTED_REQUEST_CODE ||
    candidate.name === USER_REJECTED_REQUEST_ERROR_NAME
  ) {
    return true;
  }

  return isUserRejectionWithPatterns(candidate.cause, patterns, seen);
}

export function isStructuredUserRejection(error: unknown): boolean {
  return isUserRejectionWithPatterns(error, []);
}

/**
 * Detects rejections that are specific enough to suppress from telemetry.
 * Generic "request rejected" messages remain reportable because an RPC or
 * provider can reject a request without the user choosing to deny it.
 */
export function isUserRejectionForTelemetry(error: unknown): boolean {
  return isUserRejectionWithPatterns(
    error,
    UNAMBIGUOUS_USER_REJECTION_PATTERNS,
  );
}

/**
 * Detects whether an error represents a user rejecting a wallet action
 * (e.g. declining to sign or switch chains). Checks viem's typed
 * UserRejectedRequestError and the EIP-1193 code 4001 first, then falls
 * back to a message-based check for errors that only expose a string.
 */
export function isUserRejection(error: unknown): boolean {
  return isUserRejectionWithPatterns(error, USER_REJECTION_PATTERNS);
}
