import { expect } from "@playwright/test";
import { createRequire } from "node:module";
import { encodeFunctionData, parseAbi, type Address } from "viem";
import { connectedTest as test } from "../fixtures";
import { revert, rpc, snapshot } from "./rpc";

// Prerequisite: anvil must be running and seeded before this spec runs —
//   pnpm fork:mainnet   (anvil --celo --auto-impersonate on 127.0.0.1:8545)
//   pnpm fork:seed
// This spec does not start or seed anvil itself.
//
// See swap-slippage.spec.ts's header comment for why @mento-protocol/mento-sdk
// is loaded via createRequire in this ESM package.
const require = createRequire(import.meta.url);
const { getContractAddress } = require("@mento-protocol/mento-sdk") as {
  getContractAddress: (chainId: number, name: string) => Address;
};

const CELO_CHAIN_ID = 42220;
const ACCT0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const EURM = "0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73";
const ROUTER_ADDRESS = getContractAddress(CELO_CHAIN_ID, "Router");

const ERC20_APPROVE_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
]);

// ACCT0 is one of anvil's own default unlocked dev accounts (mnemonic
// "test test ... junk"), so anvil signs for it directly — no
// anvil_impersonateAccount needed (unlike fork-seed.mjs's whale transfers,
// which impersonate accounts anvil does NOT hold keys for).
async function approveRouterMax(token: Address, owner: Address) {
  const data = encodeFunctionData({
    abi: ERC20_APPROVE_ABI,
    functionName: "approve",
    args: [ROUTER_ADDRESS, 2n ** 256n - 1n],
  });
  const hash = await rpc<string>("eth_sendTransaction", [
    { from: owner, to: token, data },
  ]);
  for (let attempt = 0; attempt < 50; attempt++) {
    const receipt = await rpc<{ status: string } | null>(
      "eth_getTransactionReceipt",
      [hash],
    );
    if (receipt) {
      if (receipt.status !== "0x1") {
        throw new Error(`approve tx ${hash} reverted`);
      }
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`approve tx ${hash} was not mined within 5s`);
}

let snapshotId: string | undefined;

test.beforeAll(async () => {
  try {
    await rpc<string>("eth_chainId");
  } catch {
    throw new Error(
      "anvil fork not reachable at 127.0.0.1:8545 — start it with `pnpm fork:mainnet` and seed with `pnpm fork:seed` before running test:connected (see spec header comment)",
    );
  }
});

test.beforeEach(async () => {
  snapshotId = await snapshot();
});
test.afterEach(async () => {
  if (snapshotId === undefined) return;
  const id = snapshotId;
  snapshotId = undefined;
  expect(await revert(id)).toBe(true);
});

test("recovers the form after the wallet rejects the swap transaction", async ({
  page,
}) => {
  // DEVIATION from a literal "reject whatever eth_sendTransaction comes
  // first": on a freshly seeded/reverted fork the Router has zero EURm
  // allowance, so the naturally-first eth_sendTransaction is the APPROVE
  // call, not the swap — rejecting that would test approve-tx rejection
  // (different error copy: "Approval transaction rejected by user." vs
  // "Swap transaction rejected by user.", see
  // packages/web3/src/features/swap/hooks/use-approve-transaction.tsx and
  // error-handlers.tsx). This spec's target is the swap-tx rejection path
  // (per #479), so the Router allowance is pre-approved directly via a raw
  // RPC call (outside the browser, so it doesn't consume the page.route
  // intercept below) — the UI then renders "swapButton" immediately and the
  // FIRST eth_sendTransaction the browser actually sends is the swap call.
  await approveRouterMax(EURM, ACCT0);

  let rejected = false;
  await page.route(
    (url) => url.hostname === "localhost" && url.port === "8545",
    async (route) => {
      const request = route.request();
      const postData = request.postData();
      if (rejected || !postData) {
        await route.continue();
        return;
      }

      let body: { id?: number; method?: string };
      try {
        body = JSON.parse(postData);
      } catch {
        await route.continue();
        return;
      }

      if (body.method === "eth_sendTransaction") {
        rejected = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            error: { code: 4001, message: "User rejected the request." },
          }),
        });
        return;
      }

      await route.continue();
    },
  );

  await page.goto("/swap/celo?from=EURm&to=USDm", {
    waitUntil: "domcontentloaded",
  });

  await expect(
    page.getByText("0xf39F...2266").filter({ visible: true }),
  ).toBeVisible({
    timeout: 20_000,
  });

  await page.getByTestId("sellAmountInput").fill("1");

  // The Router is pre-approved above, so the form goes straight to
  // "swapButton" — no approveButton branch to handle here.
  const submit = page.getByTestId("swapButton");
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  await submit.click();

  await expect(page.getByText("Confirm Swap")).toBeVisible({
    timeout: 30_000,
  });
  const confirmSwapButton = page
    .getByTestId("swapButton")
    .filter({ visible: true });
  await expect(confirmSwapButton).toBeEnabled({ timeout: 30_000 });
  await confirmSwapButton.click();

  // Exact copy from USER_ERROR_MESSAGES.SWAP_REJECTED_BY_USER
  // (packages/web3/src/features/swap/error-handlers.tsx), surfaced via
  // getSwapTransactionErrorMessage -> isUserRejection in
  // use-swap-transaction.tsx's mutation onError handler.
  await expect(
    page.getByText("Swap transaction rejected by user."),
  ).toBeVisible({ timeout: 30_000 });

  // The form recovers to a re-submittable state: use-swap-transaction.tsx's
  // onError does not call setConfirmView(false), so the confirm view stays
  // open, and swap-confirm.tsx's button testid/disabled state both key off
  // isSwapTxLoading/isSwapTxReceiptLoading, which settle back to false once
  // the mutation errors — the same (CSS-filtered) swapButton should be
  // enabled again with no further interaction.
  await expect(confirmSwapButton).toBeEnabled({ timeout: 10_000 });
  expect(rejected).toBe(true);
});
