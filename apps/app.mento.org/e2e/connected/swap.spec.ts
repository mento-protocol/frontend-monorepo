import { expect } from "@playwright/test";
import { connectedTest as test } from "../fixtures";
import { erc20BalanceOf, revert, rpc, snapshot } from "./rpc";

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
const APPROVE_SELECTOR = "0x095ea7b3";
const ALLOWANCE_SELECTOR = "0xdd62ed3e";
const ZERO_UINT256 = `0x${"0".repeat(64)}`;

type JsonRpcRequest = {
  id: number | string;
  method: string;
  params?: unknown[];
};

type JsonRpcResponse = {
  id: number | string;
  result?: unknown;
  error?: unknown;
};

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
    test.info().annotations.push({ type: "flow", description: "direct-swap" });
    await submit.click();
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

test("recovers when the first post-approval allowance read is stale", async ({
  page,
}) => {
  let approvalHash: string | undefined;
  let approvalReceiptObserved = false;
  let staleAllowanceInjected = false;

  await page.route(
    /http:\/\/(?:localhost|127\.0\.0\.1):8545\/.*/,
    async (route) => {
      let body: JsonRpcRequest | JsonRpcRequest[];
      try {
        body = route.request().postDataJSON() as
          | JsonRpcRequest
          | JsonRpcRequest[];
      } catch {
        return route.continue();
      }

      const requests = Array.isArray(body) ? body : [body];
      const upstream = await route.fetch();
      const responseBody = (await upstream.json()) as
        | JsonRpcResponse
        | JsonRpcResponse[];
      const responses = Array.isArray(responseBody)
        ? responseBody
        : [responseBody];

      const approveRequest = requests.find((request) => {
        if (request.method !== "eth_sendTransaction") return false;
        const transaction = request.params?.[0] as
          | { data?: unknown; to?: unknown }
          | undefined;
        return (
          typeof transaction?.data === "string" &&
          transaction.data.toLowerCase().startsWith(APPROVE_SELECTOR) &&
          typeof transaction.to === "string" &&
          transaction.to.toLowerCase() === CUSD.toLowerCase()
        );
      });
      if (approveRequest) {
        const approveResponse = responses.find(
          (response) => response.id === approveRequest.id,
        );
        if (typeof approveResponse?.result === "string") {
          approvalHash = approveResponse.result;
        }
      }

      const receiptRequest = requests.find(
        (request) =>
          request.method === "eth_getTransactionReceipt" &&
          request.params?.[0] === approvalHash,
      );
      if (receiptRequest) {
        const receiptResponse = responses.find(
          (response) => response.id === receiptRequest.id,
        );
        const receipt = receiptResponse?.result as
          | { status?: unknown }
          | null
          | undefined;
        if (receipt?.status === "0x1") approvalReceiptObserved = true;
      }

      const staleAllowanceRequest = requests.find((request) => {
        if (
          request.method !== "eth_call" ||
          !approvalReceiptObserved ||
          staleAllowanceInjected
        ) {
          return false;
        }
        const call = request.params?.[0] as
          | { data?: unknown; to?: unknown }
          | undefined;
        return (
          typeof call?.data === "string" &&
          call.data.toLowerCase().startsWith(ALLOWANCE_SELECTOR) &&
          typeof call.to === "string" &&
          call.to.toLowerCase() === CUSD.toLowerCase()
        );
      });

      if (!staleAllowanceRequest) {
        return route.fulfill({ response: upstream });
      }

      staleAllowanceInjected = true;
      const patchedResponses = responses.map((response) =>
        response.id === staleAllowanceRequest.id
          ? { jsonrpc: "2.0", id: response.id, result: ZERO_UINT256 }
          : response,
      );
      return route.fulfill({
        response: upstream,
        json: Array.isArray(responseBody)
          ? patchedResponses
          : patchedResponses[0],
      });
    },
  );

  await page.goto("/swap/celo?from=USDm&to=GBPm", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByText("0xf39F...2266").filter({ visible: true }),
  ).toBeVisible({ timeout: 20_000 });

  await page.getByTestId("sellAmountInput").fill("1.1");
  const approveButton = page.getByTestId("approveButton");
  await expect(approveButton).toBeEnabled({ timeout: 30_000 });
  await approveButton.click();

  await expect(page.getByText("Approve Successful")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("Confirm Swap")).toBeVisible({
    timeout: 30_000,
  });
  expect(staleAllowanceInjected).toBe(true);

  const confirmSwapButton = page
    .getByTestId("swapButton")
    .filter({ visible: true });
  await expect(confirmSwapButton).toBeEnabled({ timeout: 15_000 });
});
