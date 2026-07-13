type StorageLike = Pick<Storage, "getItem">;

const E2E_WALLET_STORAGE_KEY = "mento_e2e_wallet";

function isE2eHostname(hostname: string | undefined): boolean {
  if (!hostname) return false;
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1";
}

/** E2E test mode: mock wallet is offered instead of real wallets.
 *  Hostname-ALLOWLISTED to local development — never previews or prod. */
export function isE2eTestMode(
  hostname?: string,
  storage?: StorageLike,
): boolean {
  if (typeof window === "undefined") return false;

  const host = hostname ?? window.location?.hostname;
  if (!isE2eHostname(host)) return false;

  // Literal read — Next.js inlines NEXT_PUBLIC_* at build time. Do NOT
  // rewrite as dynamic access (process.env[name]) or route through t3-env;
  // either breaks build-time inlining + dead-code elimination.
  if (process.env.NEXT_PUBLIC_E2E_TEST === "true") return true;

  const storageSource = storage ?? readWindowStorage();
  if (!storageSource) return false;
  try {
    return storageSource.getItem(E2E_WALLET_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function readWindowStorage(): StorageLike | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
