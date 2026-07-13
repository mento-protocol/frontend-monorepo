// Prerequisites (local runbook — see #448 / #441 for the full epic):
//
//   # Terminal 1 — anvil fork of Celo mainnet (from #442; runs
//   # anvil --celo --auto-impersonate on port 8545)
//   pnpm fork:mainnet
//
//   # Terminal 2 — fund anvil accounts 0-2 (CELO + 1,000 MENTO etc.) and
//   # refresh oracle reports
//   pnpm fork:seed
//
//   # Build the app with the E2E + fork flags inlined (also builds the
//   # @repo/web3 dependency — note: the governance `dev` script does NOT
//   # watch @repo/web3, but that is irrelevant here because Playwright's
//   # webServer runs `next start` against this full turbo build)
//   NEXT_PUBLIC_E2E_TEST=true NEXT_PUBLIC_USE_FORK=true pnpm exec turbo run build --filter governance.mento.org
//
//   # Run the spec
//   pnpm --filter governance.mento.org test:connected
//
// Mixed-state caveat (REQUIRED reading before touching this file): on an
// anvil fork, the governance app runs in a mixed-state world — everything
// read through wagmi (useReadContract/useReadContracts -> RPC at
// http://localhost:8545) reflects the FORK, but everything read through
// Apollo/the-graph (the proposals list, and the lock cards -
// useGetLocksQuery in app/contracts/locking/use-locks-by-account.ts)
// reflects LIVE Celo mainnet, or renders empty because the network policy
// below blocks the subgraph host. A lock created on the fork will therefore
// NEVER appear in the lock-card list, and that is not a bug. Assert success
// ONLY via toasts and on-chain reads (the rpc helper) — never via the lock
// list UI.
import { expect, test, type Page } from "@playwright/test";
import { erc20BalanceOf, mineBlocks, revert, rpc, snapshot } from "./rpc";

const MENTO = "0x7FF62f59e3e89EA34163EA1458EEBCc81177Cfb6";
const LOCKING = "0x001Bb66636dCd149A1A2bA8C50E408BdDd80279C";
const ACCT0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const ONE_MENTO = 10n ** 18n;

// Adapted from apps/app.mento.org/e2e/fixtures.ts's connectedNetworkPolicy
// (#446). Governance has NO sanctions guard and no /api/sanctions route
// (verified — its only API routes are app/api/contract and
// app/api/sentry-example-api), so unlike app.mento.org there is nothing to
// fulfill; same-origin passthrough + external-host block + CDN placeholder
// are otherwise identical.
async function connectedNetworkPolicy(page: Page): Promise<void> {
  const PLACEHOLDER_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  const isCdnHost = (h: string): boolean =>
    h.endsWith(".public.blob.vercel-storage.com");

  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    const { hostname, pathname } = url;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      if (pathname.startsWith("/api/")) {
        return route.abort();
      }
      if (pathname === "/_next/image") {
        const target = url.searchParams.get("url") ?? "";
        const targetHost = URL.canParse(target) ? new URL(target).hostname : "";
        if (isCdnHost(targetHost)) {
          return route.fulfill({
            status: 200,
            contentType: "image/png",
            body: PLACEHOLDER_PNG,
          });
        }
      }
      // Anvil's RPC (127.0.0.1:8545, path "/") and the mock connector's
      // forwarded eth_sendTransaction calls pass through here unaffected.
      return route.continue();
    }
    if (isCdnHost(hostname)) {
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: PLACEHOLDER_PNG,
      });
    }
    // Kills subgraph, Sentry, analytics — see the mixed-state caveat above.
    return route.abort();
  });
}

// Preflight: without anvil running, snapshot() in beforeEach dies with an
// opaque "TypeError: fetch failed" — fail fast with an actionable message.
test.beforeAll(async () => {
  try {
    await rpc<string>("eth_chainId");
  } catch {
    throw new Error(
      "anvil fork not reachable at 127.0.0.1:8545 — start it with `pnpm fork:mainnet` and seed with `pnpm fork:seed` before running test:connected (see spec header comment)",
    );
  }
});

let snapshotId: string | undefined;

test.beforeEach(async ({ page }) => {
  await connectedNetworkPolicy(page);
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("mento_e2e_wallet", "true");
      window.localStorage.setItem("mento_e2e_eager_connect", "true");
      window.localStorage.setItem("mento_use_fork", "true");
    } catch {
      /* localStorage may be unavailable before navigation */
    }
  });
  // anvil snapshots are CONSUMED by evm_revert — a fresh snapshot per test.
  snapshotId = await snapshot();
});

test.afterEach(async () => {
  // Guard against beforeEach failing before assignment (e.g. anvil not
  // running) — reverting an unset snapshotId would throw a second, masking
  // error on top of the real root cause.
  if (snapshotId === undefined) return;
  const id = snapshotId;
  snapshotId = undefined;
  expect(await revert(id)).toBe(true);
});

test("creates a 1 MENTO lock and mints veMENTO", async ({ page }) => {
  // Headroom above the sum of this test's own explicit assertion timeouts
  // (30_000 + 30_000 + 120_000 = 180_000) — that sum alone leaves zero slack
  // for page.goto, the form interactions, and the trailing mineBlocks(2) +
  // balance reads, so a merely-slow (not stuck) CI run could otherwise trip
  // the outer test timeout before the real assertions get a chance to
  // resolve or fail on their own.
  test.setTimeout(240_000);

  const mentoBefore = await erc20BalanceOf(MENTO, ACCT0);
  const veMentoBefore = await erc20BalanceOf(LOCKING, ACCT0);
  expect(mentoBefore >= ONE_MENTO).toBe(true); // pnpm fork:seed must have run

  await page.goto("/voting-power", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("0xf39F...2266")).toBeVisible({
    timeout: 30_000,
  }); // eager-connected via the init-script localStorage keys above

  await page.getByTestId("lockAmountInput").fill("1");
  // Set the unlock date via the Radix slider (keyboard): more robust than
  // driving the datepickerButton calendar popover. "End" selects the max
  // valid Wednesday (~2 years out).
  await page.getByRole("slider").press("End");

  await expect(page.getByTestId("approveMentoButton")).toBeEnabled({
    timeout: 30_000,
  });

  // use-approve.ts waits 2 confirmations, use-lock-mento.ts waits 10 —
  // anvil's default automine only mines a block when a transaction arrives,
  // so mine empty blocks in the background while the flow is in progress or
  // the UI would wait for confirmations forever.
  const miner = setInterval(() => {
    void rpc("evm_mine", []).catch(() => {});
  }, 500);
  try {
    // A fresh account ALWAYS requires approval (create-lock-provider.tsx), so
    // the submit button shows "Approve MENTO" / approveMentoButton, and ONE
    // click drives the whole two-step flow: createLock() sends the ERC-20
    // approve, waits for confirmation, then automatically sends the `lock`
    // transaction.
    await page.getByTestId("approveMentoButton").click();
    await expect(page.getByText("MENTO locked successfully!")).toBeVisible({
      timeout: 120_000,
    });
  } finally {
    clearInterval(miner);
  }
  await mineBlocks(2); // settle any trailing receipt polls

  const mentoAfter = await erc20BalanceOf(MENTO, ACCT0);
  const veMentoAfter = await erc20BalanceOf(LOCKING, ACCT0);
  expect(mentoBefore - mentoAfter).toBe(ONE_MENTO);
  expect(veMentoAfter > veMentoBefore).toBe(true); // veMENTO minted (amount < 1e18 due to slope weighting)
});
