import type { config } from "@wormhole-foundation/wormhole-connect";

type BridgeTransferValidator = NonNullable<
  config.WormholeConnectConfig["validateTransferHandler"]
>;

export type ScreeningResult = "cleared" | "blocked" | "unverified";

export const BLOCKED =
  "This transfer can't be completed because one of the wallets isn't eligible to use Mento. If you believe this is an error, please contact support.";
export const UNVERIFIED =
  "We couldn't verify the wallets for this transfer. Please try again later.";

/**
 * Screens one wallet through the app's sanctions endpoint. Only a 2xx response
 * whose body reports `isSanctioned === false` clears the wallet (including the
 * route's `degraded` pass); every other outcome is treated as unverified.
 */
export async function screenAddress(
  address: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ScreeningResult> {
  if (!address.trim()) return "unverified";

  try {
    const response = await fetchImpl(
      `/api/sanctions?address=${encodeURIComponent(address)}`,
    );
    if (!response.ok) return "unverified";

    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) return "unverified";

    const { isSanctioned } = result as { isSanctioned?: unknown };
    if (isSanctioned === false) return "cleared";
    if (isSanctioned === true) return "blocked";
    return "unverified";
  } catch {
    return "unverified";
  }
}

/**
 * Builds the Wormhole Connect pre-transfer hook. Both the source and the
 * destination wallet must be cleared before the widget submits a transfer.
 */
export function createBridgeTransferValidator(
  fetchImpl: typeof fetch = fetch,
): BridgeTransferValidator {
  return async ({ fromWalletAddress, toWalletAddress }) => {
    const addresses = [fromWalletAddress, toWalletAddress];
    if (addresses.some((address) => !address?.trim())) {
      return { isValid: false, error: UNVERIFIED };
    }

    const uniqueAddresses = new Map<string, string>();
    for (const address of addresses) {
      const key = address.toLowerCase();
      if (!uniqueAddresses.has(key)) uniqueAddresses.set(key, address);
    }

    const results = await Promise.all(
      [...uniqueAddresses.values()].map((address) =>
        screenAddress(address, fetchImpl),
      ),
    );

    if (results.includes("blocked")) return { isValid: false, error: BLOCKED };
    if (results.includes("unverified")) {
      return { isValid: false, error: UNVERIFIED };
    }
    return { isValid: true };
  };
}

export const validateBridgeTransfer = createBridgeTransferValidator();
