const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_INITIAL_RETRY_DELAY_MS = 250;

type Sleep = (delayMs: number) => Promise<void>;

export type ApprovalRequirement = {
  amount: string;
  identity: string;
};

export function buildApprovalIdentity({
  account,
  chainId,
  tokenInSymbol,
}: {
  account?: string;
  chainId: number;
  tokenInSymbol?: string;
}) {
  // ERC-20 allowances are keyed by owner, sell-token contract, and spender.
  // The Router spender is chain-specific; the buy token is not part of the
  // allowance slot and must not invalidate a confirmed approval.
  return [chainId, account ?? "", tokenInSymbol ?? ""].join(":");
}

const sleep: Sleep = (delayMs) =>
  new Promise((resolve) => setTimeout(resolve, delayMs));

function parseAllowance(value: string, label: string): bigint {
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) throw new Error(`${label} cannot be negative`);
    return parsed;
  } catch (error) {
    throw new Error(`${label} is not a valid token amount: ${value}`, {
      cause: error,
    });
  }
}

export function canReuseConfirmedApproval(
  confirmed: ApprovalRequirement,
  current: ApprovalRequirement,
) {
  if (confirmed.identity !== current.identity) return false;

  try {
    return (
      parseAllowance(confirmed.amount, "Confirmed approval") >=
      parseAllowance(current.amount, "Current approval requirement")
    );
  } catch {
    return false;
  }
}

export function isSameApprovalRequirement(
  left: ApprovalRequirement,
  right: ApprovalRequirement,
) {
  return left.identity === right.identity && left.amount === right.amount;
}

export async function waitForSufficientAllowance({
  requiredAmount,
  readAllowance,
  isVerificationCurrent = () => true,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  initialRetryDelayMs = DEFAULT_INITIAL_RETRY_DELAY_MS,
  wait = sleep,
}: {
  requiredAmount: string;
  readAllowance: () => Promise<string>;
  isVerificationCurrent?: () => boolean;
  maxAttempts?: number;
  initialRetryDelayMs?: number;
  wait?: Sleep;
}): Promise<string> {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error("maxAttempts must be a positive integer");
  }
  if (!Number.isFinite(initialRetryDelayMs) || initialRetryDelayMs < 0) {
    throw new Error("initialRetryDelayMs must be non-negative");
  }

  const requiredAllowance = parseAllowance(
    requiredAmount,
    "Required allowance",
  );
  let lastObservedAllowance: string | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (!isVerificationCurrent()) {
      throw new Error("Allowance verification context changed");
    }

    try {
      const observedAllowance = await readAllowance();
      if (!isVerificationCurrent()) {
        throw new Error("Allowance verification context changed");
      }
      lastObservedAllowance = observedAllowance;
      lastError = undefined;

      if (
        parseAllowance(observedAllowance, "Observed allowance") >=
        requiredAllowance
      ) {
        return observedAllowance;
      }
    } catch (error) {
      if (!isVerificationCurrent()) {
        throw new Error("Allowance verification context changed", {
          cause: error,
        });
      }
      lastError = error;
    }

    if (attempt < maxAttempts - 1) {
      await wait(initialRetryDelayMs * 2 ** attempt);
    }
  }

  const observedDetail =
    lastObservedAllowance === undefined
      ? "no allowance was observed"
      : `last observed ${lastObservedAllowance}`;
  throw new Error(
    `Allowance remained below ${requiredAmount} after ${maxAttempts} attempts (${observedDetail})`,
    { cause: lastError },
  );
}
