import { expect } from "@playwright/test";
import { connectedTest as test } from "../fixtures";
import { erc20BalanceOf, revert, rpc, snapshot } from "./rpc";

// Prerequisite: anvil must be running and seeded before this spec runs —
//   pnpm fork:mainnet   (anvil --celo --auto-impersonate on 127.0.0.1:8545)
//   pnpm fork:seed
// This spec does not start or seed anvil itself.
//
// Oracle-staleness caveat: see swap.spec.ts's header comment — re-run
// `pnpm fork:seed` if quotes start failing.
//
// Issue #479 wants a REPRESENTATIVE swap-pair matrix, not the old 169-combo
// sweep. This file adds 2 pairs beyond the EURm -> USDm pair already covered
// by swap.spec.ts, chosen among seeded sell tokens (USDm, EURm, USDC — see
// scripts/fork-seed.mjs) with confirmed oracle + route coverage:
//   - USDm -> USDC: a direct 1-hop stable/stable route.
//   - EURm -> GBPm: a 2-hop cross-currency route (both legs re-reported by
//     fork-seed's RELAYERS map), exercising a different route shape than the
//     other pairs in this suite.
// Both pairs were confirmed to quote and swap successfully against a local
// seeded fork (sdk.routes.findRoute + sdk.quotes.getAmountOut) before being
// committed here.
const ACCT0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const USDC = "0xcebA9300f2b948710d2653dD7B07f33A8B32118C";
const GBPM = "0xCCF663b1fF11028f0b19058d0f7B674004a40746";

const PAIRS = [
  { from: "USDm", to: "USDC", buyToken: USDC },
  { from: "EURm", to: "GBPm", buyToken: GBPM },
] as const;

let snapshotId: string | undefined;

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

for (const { from, to, buyToken } of PAIRS) {
  test(`swaps 1 ${from} for ${to}`, async ({ page }) => {
    const balanceBefore = await erc20BalanceOf(buyToken, ACCT0);

    await page.goto(`/swap/celo?from=${from}&to=${to}`, {
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

    // Button is `approveButton` when the Broker needs a from-token allowance,
    // else `swapButton`.
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
      // Approval success auto-opens the confirm view
      // (setConfirmView(true) in use-swap-form.tsx) — do not click swapButton
      // again on the form; it's already gone.
    } else {
      test
        .info()
        .annotations.push({ type: "flow", description: "direct-swap" });
      await submit.click();
    }
    await expect(page.getByText("Confirm Swap")).toBeVisible({
      timeout: 30_000,
    });
    // swap-page-content.tsx deliberately keeps SwapForm mounted (toggling
    // only `hidden` via CSS) to avoid a DOM removeChild crash on route
    // transitions, so the form's own (CSS-hidden) swapButton still matches
    // this testid alongside the confirm view's — filter to the visible one.
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

    const balanceAfter = await erc20BalanceOf(buyToken, ACCT0);
    expect(balanceAfter > balanceBefore).toBe(true);
  });
}
