import { expect } from "@playwright/test";
import { connectedMonadTest as test } from "../fixtures";
import { createRpcClient } from "./rpc";

// Prerequisite: a Monad mainnet anvil fork must be running and seeded before
// this spec runs —
//   pnpm fork:monad        (anvil --auto-impersonate, chain 143, on 127.0.0.1:8546)
//   pnpm fork:seed:monad
// This spec does not start or seed anvil itself. It is the Monad sibling of
// swap.spec.ts (Celo, 8545); the two forks run on different ports so both can
// coexist. Build the app with NEXT_PUBLIC_MONAD_RPC_URL=http://localhost:8546
// so wagmi AND the mento-sdk public client both talk to this fork.
//
// Oracle-staleness caveat: identical to swap.spec.ts — Router quotes depend on
// SortedOracles median freshness (the EURm/USDm feed's report expiry is 360s).
// Re-run `pnpm fork:seed:monad` if a quote error appears. Short runs right
// after seeding are fine.
//
// Chain-switch: unlike Celo, the mock connector connects on chains[0] (Celo,
// 42220), not Monad — so /swap/monad first renders the ChainMismatchBanner.
// The test drives the real "Switch to Monad" UI (useSwitchChain via the mock
// connector) before swapping, exercising the cross-chain switch path the Celo
// spec never touches.
//
// Pair choice mirrors swap.spec.ts: EURm (a real SDK-registered token on
// chain 143, seeded by fork-seed-monad.mjs) -> USDm (the hub stable), which
// still runs the full approve -> confirm -> swap flow with a real on-chain
// balance assertion.
const RPC_URL = "http://127.0.0.1:8546";
const MONAD_CHAIN_ID = "0x8f"; // 143
const ACCT0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const USDM = "0xBC69212B8E4d445b2307C9D32dD68E2A4Df00115";

const { rpc, snapshot, revert, erc20BalanceOf } = createRpcClient(RPC_URL);

let snapshotId: string | undefined;

// Preflight: fail fast with an actionable message if the Monad fork is not up,
// instead of an opaque "TypeError: fetch failed" from snapshot() in beforeEach.
// Also asserts it is really a chain-143 fork so this never silently passes
// against the wrong anvil (e.g. the Celo fork on a mis-set port).
test.beforeAll(async () => {
  let chainId: string;
  try {
    chainId = await rpc<string>("eth_chainId");
  } catch {
    throw new Error(
      "Monad anvil fork not reachable at 127.0.0.1:8546 — start it with `pnpm fork:monad` and seed with `pnpm fork:seed:monad` before running test:connected:monad (see spec header comment)",
    );
  }
  if (chainId !== MONAD_CHAIN_ID) {
    throw new Error(
      `127.0.0.1:8546 reports chain ${chainId}, not Monad mainnet (${MONAD_CHAIN_ID}) — is the right fork running? (pnpm fork:monad)`,
    );
  }
});

// anvil snapshots are CONSUMED by evm_revert — a fresh snapshot per test.
test.beforeEach(async () => {
  snapshotId = await snapshot();
});
test.afterEach(async () => {
  // Guard against beforeEach failing before assignment (e.g. anvil not
  // running) — reverting an unset snapshotId would throw a second, masking
  // error on top of the real root cause.
  if (snapshotId === undefined) return;
  // Clear before awaiting so a later test never reverts this stale,
  // already-consumed id.
  const id = snapshotId;
  snapshotId = undefined;
  // anvil returns false (not an error) for an unknown/consumed snapshot id,
  // so assert the result — a silent no-op here would break fork isolation.
  expect(await revert(id)).toBe(true);
});

test("swaps 1 EURm for USDm on Monad (chain 143)", async ({ page }) => {
  const balanceBefore = await erc20BalanceOf(USDM, ACCT0);

  // Assert the app actually talks to the Monad fork (port 8546), not the Celo
  // fork — proves NEXT_PUBLIC_MONAD_RPC_URL wiring reached both wagmi and the
  // SDK's public client. Collected across the whole flow, checked after the
  // swap.
  let forkRequestCount = 0;
  page.on("request", (request) => {
    try {
      if (new URL(request.url()).port === "8546") forkRequestCount++;
    } catch {
      /* non-URL request targets are irrelevant here */
    }
  });

  await page.goto("/swap/monad?from=EURm&to=USDm", {
    waitUntil: "domcontentloaded",
  });

  // Eager-connect happens via the fixture's init-script localStorage keys.
  // The header renders both a mobile (`md:hidden`) and a desktop
  // (`md:block hidden`) ConnectButton simultaneously — filter to the one
  // actually visible at this project's viewport instead of `.first()`.
  await expect(
    page.getByText("0xf39F...2266").filter({ visible: true }),
  ).toBeVisible({
    timeout: 20_000,
  });

  // The mock connector joins on Celo (chains[0]); /swap/monad targets chain
  // 143, so the ChainMismatchBanner offers a switch. `exact: true` targets the
  // banner's "Switch to Monad" and not the swap form's own disabled
  // "Switch to Monad to swap" CTA. Drive the real UI, then wait for the banner
  // to clear (walletChainId === 143 hides it).
  const switchButton = page.getByRole("button", {
    name: "Switch to Monad",
    exact: true,
  });
  await expect(switchButton).toBeVisible({ timeout: 20_000 });
  await switchButton.click();
  await expect(switchButton).toBeHidden({ timeout: 20_000 });

  await page.getByTestId("sellAmountInput").fill("1");

  // Button is `approveButton` when the Router needs a EURm allowance, else
  // `swapButton`.
  const submit = page.getByTestId(/^(approveButton|swapButton)$/);
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  if ((await submit.getAttribute("data-testid")) === "approveButton") {
    test.info().annotations.push({
      type: "flow",
      description: "approve-then-swap",
    });
    await submit.click();
    await expect(page.getByText("Approve Successful")).toBeVisible({
      timeout: 60_000,
    });
    // Approval success auto-opens the confirm view (setConfirmView(true) in
    // use-swap-form.tsx) — do not click swapButton again on the form.
  } else {
    test.info().annotations.push({ type: "flow", description: "direct-swap" });
    await submit.click();
  }
  await expect(page.getByText("Confirm Swap")).toBeVisible({
    timeout: 30_000,
  });
  // swap-page-content.tsx keeps SwapForm mounted (toggling only `hidden`), so
  // the form's own CSS-hidden swapButton still matches this testid alongside
  // the confirm view's — filter to the visible one.
  const confirmSwapButton = page
    .getByTestId("swapButton")
    .filter({ visible: true });
  await expect(confirmSwapButton).toBeEnabled({
    timeout: 30_000,
  });
  await confirmSwapButton.click();
  await expect(page.getByText("Swap Successful")).toBeVisible({
    timeout: 60_000,
  });

  // Three-way assertion: UI (above), on-chain (below), and network — the app
  // must have hit the Monad fork on 8546 at least once for quotes/balances/tx.
  expect(forkRequestCount).toBeGreaterThan(0);

  const balanceAfter = await erc20BalanceOf(USDM, ACCT0);
  expect(balanceAfter > balanceBefore).toBe(true);
});
