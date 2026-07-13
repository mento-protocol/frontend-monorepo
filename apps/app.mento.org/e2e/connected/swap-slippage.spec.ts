import { expect } from "@playwright/test";
import { createRequire } from "node:module";
import {
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem";
import { connectedTest as test } from "../fixtures";
import { revert, rpc, snapshot } from "./rpc";

// Prerequisite: anvil must be running and seeded before this spec runs —
//   pnpm fork:mainnet   (anvil --celo --auto-impersonate on 127.0.0.1:8545)
//   pnpm fork:seed
// This spec does not start or seed anvil itself.
//
// This package (apps/app.mento.org) is `"type": "module"`, so Playwright
// loads this spec as native ESM. @mento-protocol/mento-sdk's package.json
// `exports` map points the ESM ("import") condition at a dist/esm build with
// broken extensionless relative imports (verified: `node --input-type=module
// -e "import('@mento-protocol/mento-sdk')"` throws ERR_MODULE_NOT_FOUND on
// dist/esm/core/constants/chainId). The CJS ("require") condition is fine.
// `createRequire` forces CJS resolution regardless of this file's own module
// type, sidestepping the broken ESM build entirely.
const require = createRequire(import.meta.url);
const { ROUTER_ABI, getContractAddress } =
  require("@mento-protocol/mento-sdk") as {
    ROUTER_ABI: readonly unknown[];
    getContractAddress: (chainId: number, name: string) => Address;
  };

const CELO_CHAIN_ID = 42220;
const ROUTER_ADDRESS = getContractAddress(CELO_CHAIN_ID, "Router");
const CUSTOM_SLIPPAGE_PERCENT = "15";

// SwapService.calculateMinAmountOut in the pinned mento-sdk
// (dist/services/swap/SwapService.js): basisPoints = floor(slippage * 100),
// amountOutMin = expectedAmountOut * (10000 - basisPoints) / 10000n, both
// integer bigint math with 10000n-scaled basis points.
const BASIS_POINTS = BigInt(Math.floor(Number(CUSTOM_SLIPPAGE_PERCENT) * 100));
const SLIPPAGE_MULTIPLIER = 10000n - BASIS_POINTS;

// Route[] struct as decoded from Router ABI's swapExactTokensForTokens.
type DecodedRoute = { from: Address; to: Address; factory: Address };

let snapshotId: string | undefined;
let capturedSwapCall:
  | { amountIn: bigint; amountOutMin: bigint; expectedAmountOut: bigint }
  | undefined;

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
  capturedSwapCall = undefined;
});
test.afterEach(async () => {
  if (snapshotId === undefined) return;
  const id = snapshotId;
  snapshotId = undefined;
  expect(await revert(id)).toBe(true);
});

test("applies custom slippage to the on-chain amountOutMin", async ({
  page,
}) => {
  // Route registered here (inside the test body) runs AFTER the connectedTest
  // fixture's own page.route("**/*", ...) (registered in the `page` fixture
  // setup, before this test body executes) — Playwright matches the
  // LAST-registered handler first, so this intercepts eth_sendTransaction
  // calls before the fixture's passthrough handler sees them. Every request
  // that isn't a swap-to-Router call is passed straight through via
  // route.continue(), preserving the fixture's network policy.
  await page.route(
    (url) => url.hostname === "localhost" && url.port === "8545",
    async (route) => {
      const request = route.request();
      const postData = request.postData();
      if (!postData) {
        await route.continue();
        return;
      }

      let body: {
        method?: string;
        params?: [{ to?: string; data?: Hex }];
      };
      try {
        body = JSON.parse(postData);
      } catch {
        await route.continue();
        return;
      }

      const to = body.params?.[0]?.to;
      const data = body.params?.[0]?.data;
      if (
        body.method === "eth_sendTransaction" &&
        to?.toLowerCase() === ROUTER_ADDRESS.toLowerCase() &&
        data
      ) {
        const decoded = decodeFunctionData({
          abi: ROUTER_ABI,
          data,
        });
        if (decoded.functionName === "swapExactTokensForTokens") {
          const [amountIn, amountOutMin, routes] = decoded.args as [
            bigint,
            bigint,
            DecodedRoute[],
            Address,
            bigint,
          ];

          // Query the router for the current expected output using the EXACT
          // same amountIn/routes the app just built, BEFORE forwarding this
          // transaction (i.e. before it mines) — this reads the identical
          // pre-swap pool state the app's own buildSwapParams() saw when it
          // computed amountOutMin a moment earlier.
          const getAmountsOutData = encodeFunctionData({
            abi: ROUTER_ABI,
            functionName: "getAmountsOut",
            args: [amountIn, routes],
          });
          const rawResult = await rpc<Hex>("eth_call", [
            { to: ROUTER_ADDRESS, data: getAmountsOutData },
            "latest",
          ]);
          const amounts = decodeFunctionResult({
            abi: ROUTER_ABI,
            functionName: "getAmountsOut",
            data: rawResult,
          }) as bigint[];
          const expectedAmountOut = amounts[amounts.length - 1] as bigint;

          capturedSwapCall = { amountIn, amountOutMin, expectedAmountOut };
        }
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

  // Set a distinctive custom slippage before entering the confirm view — the
  // settings popover unmounts once confirmView is true
  // (swap-page-content.tsx: `{!confirmView && <SwapSettingsPopover />}`).
  await page.getByTestId("swapSettingsButton").click();
  const slippageInput = page.getByTestId("slippageInput");
  await expect(slippageInput).toBeVisible();
  await slippageInput.fill(CUSTOM_SLIPPAGE_PERCENT);
  await expect(slippageInput).toHaveValue(CUSTOM_SLIPPAGE_PERCENT);
  await page.keyboard.press("Escape");

  await page.getByTestId("sellAmountInput").fill("1");

  const submit = page.getByTestId(/^(approveButton|swapButton)$/);
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  if ((await submit.getAttribute("data-testid")) === "approveButton") {
    await submit.click();
    await expect(page.getByText("Approve Successful")).toBeVisible({
      timeout: 60_000,
    });
  } else {
    await submit.click();
  }
  await expect(page.getByText("Confirm Swap")).toBeVisible({
    timeout: 30_000,
  });

  // Sanity-check the confirm view reflects the custom slippage before
  // submitting.
  await expect(page.getByTestId("slippageLabel")).toHaveText(
    `${CUSTOM_SLIPPAGE_PERCENT}%`,
  );

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

  if (!capturedSwapCall) {
    throw new Error(
      "No swapExactTokensForTokens call to the Router was captured — the route intercept did not see the swap transaction.",
    );
  }
  const { amountIn, amountOutMin, expectedAmountOut } = capturedSwapCall;
  expect(amountIn > 0n).toBe(true);

  const expectedAmountOutMin =
    (expectedAmountOut * SLIPPAGE_MULTIPLIER) / 10000n;

  // Compare as a ratio rather than exact equality — a small tolerance
  // absorbs any block-timing skew between the app's own quote fetch and this
  // spec's getAmountsOut re-check, both of which happen microseconds apart
  // on an otherwise-idle fork.
  const diff =
    expectedAmountOutMin > amountOutMin
      ? expectedAmountOutMin - amountOutMin
      : amountOutMin - expectedAmountOutMin;
  const toleranceBasisPoints = 50n; // 0.5%
  expect(diff * 10000n <= expectedAmountOutMin * toleranceBasisPoints).toBe(
    true,
  );
});
