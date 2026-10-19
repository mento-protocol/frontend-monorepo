/**
 * Removes wallet data from values sent to Sentry.
 *
 * Every run of 40 or more hex characters after `0x` is replaced with
 * `0x[redacted]`. That covers wallet addresses, calldata (which embeds
 * addresses) and transaction hashes (which identify their sender on-chain).
 */
const WALLET_DATA_PATTERN = /0x[0-9a-fA-F]{40,}/g;
const REDACTED = "0x[redacted]";
const MAX_DEPTH = 8;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function redactValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    return value.replace(WALLET_DATA_PATTERN, REDACTED);
  }
  if (Array.isArray(value)) {
    // Past the depth limit, drop the contents rather than send them unredacted.
    if (depth >= MAX_DEPTH) return "[Array]";
    return value.map((item) => redactValue(item, depth + 1));
  }
  if (isPlainObject(value)) {
    if (depth >= MAX_DEPTH) return "[Object]";
    const redacted: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      redacted[key] = redactValue(item, depth + 1);
    }
    return redacted;
  }
  return value;
}

/**
 * Returns a copy of `value` with wallet data redacted from every string,
 * walking plain objects and arrays up to 8 levels deep. Other values are
 * returned untouched.
 */
export function redactWalletData<T>(value: T): T {
  return redactValue(value, 0) as T;
}
