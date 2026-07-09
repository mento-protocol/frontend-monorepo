import { expect } from "@playwright/test";
import { connectedTest as test } from "../fixtures";
import { erc20BalanceOf, revert, snapshot } from "./rpc";

// Prerequisite: anvil must be running and seeded before this spec runs —
//   pnpm fork:mainnet   (anvil --celo --auto-impersonate on 127.0.0.1:8545)
//   pnpm fork:seed
// This spec does not start or seed anvil itself.
//
// Oracle-staleness caveat: Mento quotes depend on SortedOracles median
// freshness. Right after `pnpm fork:seed` the medians are fresh; they go
// stale on wall-clock time. If the submit button shows "Rate temporarily
// unavailable" or a quote error, re-run `pnpm fork:seed` and re-run the suite.
// Short spec runs immediately after seeding are fine.
//
// DEVIATION from the issue's literal "swap 1 CELO for cUSD": the swap form's
// token selector is populated from getTokenOptionsByChainId(), which is
// Object.keys(TOKEN_ADDRESSES_BY_CHAIN[chainId]) from the pinned
// @mento-protocol/mento-sdk@3.3.0-beta.1 (packages/web3/src/config/tokens.ts).
// That map has no "CELO" entry for Celo mainnet (verified by inspecting the
// installed SDK at runtime) — the native token is not a selectable sell/buy
// option anywhere the form validates tokenIn/tokenOut symbols, so `?from=CELO`
// silently falls back to the default pair instead of erroring. This is a
// pre-existing SDK/frontend limitation, out of scope for this issue (which may
// not touch packages/web3 or bump the SDK) — flagged for the team, not fixed
// here. Using EURm (cEUR) -> USDm (cUSD) instead: both are real
// SDK-registered tokens, both are seeded by fork-seed.mjs, and the swap still
// exercises the full approve -> confirm -> swap flow with a real on-chain
// balance assertion, per the acceptance criteria's "cUSD balance ... increased
// ON-CHAIN" check.
const ACCT0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const CUSD = "0x765DE816845861e75A25fCA122bb6898B8B1282a";

let snapshotId: string;

// anvil snapshots are CONSUMED by evm_revert — a fresh snapshot per test.
test.beforeEach(async () => {
  snapshotId = await snapshot();
});
test.afterEach(async () => {
  // Guard against beforeEach failing before assignment (e.g. anvil not
  // running) — reverting an unset snapshotId would throw a second, masking
  // error on top of the real root cause.
  if (snapshotId) await revert(snapshotId);
});

test("swaps 1 EURm (cEUR) for USDm (cUSD)", async ({ page }) => {
  const balanceBefore = await erc20BalanceOf(CUSD, ACCT0);

  await page.goto("/swap/celo?from=EURm&to=USDm", {
    waitUntil: "domcontentloaded",
  });

  // Eager-connect happens via the fixture's init-script localStorage keys.
  // The header renders both a mobile (`md:hidden`) and a desktop
  // (`md:block hidden`) ConnectButton simultaneously — filter to the one
  // actually visible at this project's viewport instead of `.first()`,
  // which would resolve to the DOM-first (mobile, hidden here) copy.
  await expect(
    page.getByText("0xf39F...2266").filter({ visible: true }),
  ).toBeVisible({
    timeout: 20_000,
  });

  await page.getByTestId("sellAmountInput").fill("1");

  // Button is `approveButton` when the Broker needs a EURm allowance, else
  // `swapButton`.
  const submit = page.getByTestId(/^(approveButton|swapButton)$/);
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  if ((await submit.getAttribute("data-testid")) === "approveButton") {
    await submit.click();
    await expect(page.getByText("Approve Successful")).toBeVisible({
      timeout: 60_000,
    });
    // Approval success auto-opens the confirm view
    // (setConfirmView(true) in use-swap-form.tsx) — do not click swapButton
    // again on the form; it's already gone.
  } else {
    await page.getByTestId("swapButton").click();
  }
  await expect(page.getByText("Confirm Swap")).toBeVisible({
    timeout: 30_000,
  });
  // swap-page-content.tsx deliberately keeps SwapForm mounted (toggling only
  // `hidden` via CSS) to avoid a DOM removeChild crash on route transitions,
  // so the form's own (CSS-hidden) swapButton still matches this testid
  // alongside the confirm view's — filter to the visible one.
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

  const balanceAfter = await erc20BalanceOf(CUSD, ACCT0);
  expect(balanceAfter > balanceBefore).toBe(true);
});
