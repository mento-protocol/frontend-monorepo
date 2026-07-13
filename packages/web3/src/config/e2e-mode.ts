type StorageLike = Pick<Storage, "getItem">;

const E2E_WALLET_STORAGE_KEY = "mento_e2e_wallet";

// Team Vercel previews: no embedded dot before the suffix (blocks
// subdomain-injection lookalikes like "foo.bar-mentolabs.vercel.app"), and
// anchored at the end (blocks suffix-forgery like "...-mentolabs.vercel.app.evil.com").
// Matches both "appmento-<hash>-mentolabs.vercel.app" (hash previews) and
// "<project>-git-<branch>-mentolabs.vercel.app" (branch aliases).
const PREVIEW_HOSTNAME_PATTERN = /^[a-z0-9-]+-mentolabs\.vercel\.app$/;

function isE2eHostname(hostname: string | undefined): boolean {
  if (!hostname) return false;
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    PREVIEW_HOSTNAME_PATTERN.test(normalized)
  );
}

/** E2E test mode: mock wallet is offered instead of real wallets.
 *  Hostname-ALLOWLISTED to local development AND the team's
 *  `-mentolabs.vercel.app` Vercel previews — production domains remain
 *  excluded. Preview exposure is benign: the mock connector holds no keys,
 *  cannot send unsigned transactions through public RPCs, and its accounts
 *  are fixed public junk addresses (packages/web3/src/config/test-wallet.ts)
 *  — the same convention already used for the fork-mode/RPC-override debug
 *  knobs in rpc-overrides.ts. */
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
