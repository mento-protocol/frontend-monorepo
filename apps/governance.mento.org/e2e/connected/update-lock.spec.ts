// Prerequisites (local runbook — see #479 / #448 / #441): identical to
// lock.spec.ts. Start the fork, seed it, build governance in E2E+fork mode,
// then run the connected project:
//
//   pnpm fork:mainnet          # Terminal 1 — anvil --celo fork on :8545
//   pnpm fork:seed             # Terminal 2 — fund accounts 0-2, refresh oracles
//   NEXT_PUBLIC_E2E_TEST=true NEXT_PUBLIC_USE_FORK=true \
//     pnpm exec turbo run build --filter governance.mento.org
//   pnpm --filter governance.mento.org test:connected
//
// WHY THIS SPEC MOCKS THE SUBGRAPH (the hard part — read before editing):
// The ONLY UI entry to the relock/update flow is the "Update" button on a
// LockCard in LockList, which renders exclusively from useLocksByAccount ->
// Apollo useQuery(GetLocksDocument) (app/graphql/subgraph/queries/getLocks.graphql,
// fetchPolicy: network-only) against env.NEXT_PUBLIC_SUBGRAPH_URL — a LIVE
// mainnet Graph gateway. On the fork that host is unreachable/aborted by the
// network policy (see the "mixed-state caveat" in lock.spec.ts), so LockList
// renders empty and no updateLockButton ever exists. Impersonating a real
// mainnet locked account is impossible here (the mock connector is hardcoded
// to anvil junk accounts) and would be non-deterministic (live subgraph vs.
// pinned fork block).
//
// So this spec extends lock.spec.ts's network policy with ONE special case:
// the getLocks GraphQL operation is route.fulfill()ed with a SYNTHETIC
// response built from ACTUAL fork state — we first create a real lock on the
// fork, read its on-chain parameters out of the Locking contract's LockCreate
// event, and shape those into the exact GetLocksQuery response so LockList
// renders a card backed by a lock that genuinely exists on-chain. The relock
// mutation itself (useRelockMento -> Locking.relock) is fully fork-correct.
//
// MAINTENANCE COUPLING: buildGetLocksResponse() below is hand-shaped to match
// getLocks.graphql / the generated GetLocksQuery type. If that query gains or
// renames a selected field, this mock must be updated in lockstep or the page
// will read `undefined` off the mocked lock. This is the documented cost of
// the subgraph-mock technique (also noted in docs/wallet-testing.md).
//
// Mixed-state caveat still applies: the lock CARD amounts are driven by the
// (mocked/blocked) subgraph and by useQuery(GetWithdrawalsDocument), which we
// DELIBERATELY leave empty — so success is asserted ONLY via the toast and
// on-chain reads (erc20BalanceOf against the fork), NEVER via the lock-card UI.
import { expect, test, type Page } from "@playwright/test";
import { erc20BalanceOf, mineBlocks, revert, rpc, snapshot } from "./rpc";

const MENTO = "0x7FF62f59e3e89EA34163EA1458EEBCc81177Cfb6";
const LOCKING = "0x001Bb66636dCd149A1A2bA8C50E408BdDd80279C";
const ACCT0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const ONE_MENTO = 10n ** 18n;

// Host of NEXT_PUBLIC_SUBGRAPH_URL (both mainnet + celo-sepolia gateways in
// .env.example live under this host, and the e2e.yml governance job pins the
// mainnet one). Requests to it are synthesised below instead of hitting the
// network.
const SUBGRAPH_HOST = "gateway.thegraph.com";

// keccak256("LockCreate(uint256,address,address,uint256,uint256,uint256,uint256)")
// — the Locking contract's lock-creation event (see LockingABI in @repo/web3).
// Indexed: id, account, delegate. Data words: time, amount, slopePeriod, cliff.
const LOCK_CREATE_TOPIC =
  "0x9024bda3efb3f3701e8d25fdb8d8adb67deb176633f590ee4a3cd1dad74dc73e";

interface ForkLock {
  lockId: bigint;
  owner: string;
  delegate: string;
  time: bigint;
  amount: bigint;
  slope: number;
  cliff: number;
}

const topicAddress = (address: string): string =>
  `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;

// Read the single LockCreate event emitted for `account` since `fromBlock` and
// decode it into the exact fields the subgraph exposes. The junk account has no
// mainnet lock history, so exactly one event matches after we create a lock.
async function readCreatedLock(
  account: string,
  fromBlock: string,
): Promise<ForkLock> {
  const logs = await rpc<{ topics: string[]; data: string }[]>("eth_getLogs", [
    {
      address: LOCKING,
      fromBlock,
      toBlock: "latest",
      topics: [LOCK_CREATE_TOPIC, null, topicAddress(account)],
    },
  ]);
  const log = logs[0];
  if (!log) {
    throw new Error(
      "no LockCreate event found for the junk account — the lock transaction did not land on the fork",
    );
  }
  const data = log.data.slice(2);
  const word = (index: number): bigint =>
    BigInt(`0x${data.slice(index * 64, (index + 1) * 64)}`);
  return {
    lockId: BigInt(log.topics[1]!),
    owner: `0x${log.topics[2]!.slice(26)}`,
    delegate: `0x${log.topics[3]!.slice(26)}`,
    time: word(0),
    amount: word(1),
    slope: Number(word(2)),
    cliff: Number(word(3)),
  };
}

// Shape a fork lock into the EXACT GetLocksQuery response (see
// app/graphql/subgraph/generated/subgraph.tsx -> GetLocksQuery). owner and
// delegate are the connected junk account, so LockList badges it "personal"
// and renders the updateLockButton. lockCreate is left empty (the page never
// reads it on /voting-power) and withdrawals are handled separately.
function buildGetLocksResponse(lock: ForkLock): unknown {
  return {
    data: {
      locks: [
        {
          __typename: "Lock",
          lockId: lock.lockId.toString(),
          relocked: false,
          amount: lock.amount.toString(),
          time: lock.time.toString(),
          slope: lock.slope,
          cliff: lock.cliff,
          owner: { __typename: "Account", id: lock.owner.toLowerCase() },
          replacedBy: null,
          replaces: null,
          lockCreate: [],
          delegate: { __typename: "Account", id: lock.delegate.toLowerCase() },
        },
      ],
    },
  };
}

// Mutable holder read live by the network-policy route handler. Null until the
// real lock has been created and decoded; while null the getLocks operation
// resolves to an empty (but structurally valid) list so the page renders during
// lock creation without crashing on `data.locks`.
let mockedLocksResponse: unknown | null = null;

// Adapted from lock.spec.ts's connectedNetworkPolicy, plus a subgraph-host
// branch that fulfils getLocks synthetically and returns empty data for every
// other subgraph operation (proposals, withdrawals, ...).
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
      // Anvil's RPC (127.0.0.1:8545) and the mock connector's forwarded
      // eth_sendTransaction calls pass through here unaffected.
      return route.continue();
    }
    if (isCdnHost(hostname)) {
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: PLACEHOLDER_PNG,
      });
    }
    // The subgraph host: synthesise instead of hitting the live gateway.
    if (hostname === SUBGRAPH_HOST) {
      let body: { operationName?: string; query?: string } | undefined;
      try {
        body = route.request().postDataJSON();
      } catch {
        body = undefined;
      }
      const isGetLocks =
        body?.operationName === "getLocks" ||
        (body?.query?.includes("getLocks") ?? false);
      const payload = isGetLocks
        ? (mockedLocksResponse ?? { data: { locks: [] } })
        : { data: {} };
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(payload),
      });
    }
    // Kills Sentry, analytics, and any other external host — as in lock.spec.ts.
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
  mockedLocksResponse = null;
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
  if (snapshotId === undefined) return;
  const id = snapshotId;
  snapshotId = undefined;
  expect(await revert(id)).toBe(true);
});

test("tops up and extends an existing lock via the subgraph-mocked update flow", async ({
  page,
}) => {
  test.setTimeout(240_000);

  const mentoStart = await erc20BalanceOf(MENTO, ACCT0);
  const veMentoStart = await erc20BalanceOf(LOCKING, ACCT0);
  expect(mentoStart >= 2n * ONE_MENTO).toBe(true); // pnpm fork:seed must have run

  // use-approve.ts waits 2 confirmations, use-lock-mento.ts 10, and relock
  // waits for the receipt — anvil's automine only mines on a new tx, so mine
  // empty blocks in the background for the whole flow.
  const miner = setInterval(() => {
    void rpc("evm_mine", []).catch(() => {});
  }, 500);

  try {
    // ---- 1. Create a real, SHORT lock on the fork (headroom to extend later).
    const blockBeforeCreate = await rpc<string>("eth_blockNumber");

    await page.goto("/voting-power", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("0xf39F...2266")).toBeVisible({
      timeout: 30_000,
    }); // eager-connected via the init-script localStorage keys

    // The amount field's max-validation runs against the wagmi MENTO balance;
    // if we fill before that balance has loaded it validates against 0 and
    // sticks on "Insufficient balance" (RHF does not re-validate the amount
    // when the balance later resolves). Wait for a non-zero balance to render.
    await expect(page.getByText(/Balance:\s*[1-9]/).first()).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId("lockAmountInput").fill("1");
    // "Home" selects the shortest valid duration (~1 week, slope 1 — the
    // contract's minSlopePeriod), leaving maximal room to extend in the update
    // dialog. (lock.spec.ts presses "End" for the max; we want the opposite.)
    await page.getByRole("slider").press("Home");

    await page.getByTestId("approveMentoButton").click();
    await expect(page.getByText("MENTO locked successfully!")).toBeVisible({
      timeout: 120_000,
    });
    await mineBlocks(2); // settle trailing receipt polls

    const mentoAfterCreate = await erc20BalanceOf(MENTO, ACCT0);
    const veMentoAfterCreate = await erc20BalanceOf(LOCKING, ACCT0);
    expect(mentoStart - mentoAfterCreate).toBe(ONE_MENTO);
    expect(veMentoAfterCreate > veMentoStart).toBe(true);

    // ---- 2. Read the real lock off-chain-truthfully and arm the getLocks mock.
    const lock = await readCreatedLock(ACCT0, blockBeforeCreate);
    expect(lock.owner.toLowerCase()).toBe(ACCT0.toLowerCase());
    expect(lock.amount).toBe(ONE_MENTO);
    mockedLocksResponse = buildGetLocksResponse(lock);

    // ---- 3. Reload so LockList renders the mocked card, then open the dialog.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText("0xf39F...2266")).toBeVisible({
      timeout: 30_000,
    });
    const card = page.getByTestId("lockCard_0");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.getByTestId("updateLockButton").click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // ---- 4. Top up (+1 MENTO) AND extend (slider "End") — the richest path.
    // Same balance-load race as the create form above (see comment there).
    await expect(dialog.getByText(/Balance:\s*[1-9]/).first()).toBeVisible({
      timeout: 30_000,
    });
    await dialog.getByTestId("updateLockAmountInput").fill("1");
    await dialog.getByRole("slider").press("End");

    // A top-up always needs an allowance top-up first, so the submit button is
    // "Approve MENTO" (approveMentoButton); ONE click drives approve ->
    // relock (handleRelock in locking-button.tsx chains them).
    await dialog.getByTestId("approveMentoButton").click();
    await expect(page.getByText("Lock updated successfully")).toBeVisible({
      timeout: 120_000,
    });
    await mineBlocks(2);

    // ---- 5. Assert ONLY on-chain (never via the mocked lock-card UI).
    const mentoAfterRelock = await erc20BalanceOf(MENTO, ACCT0);
    const veMentoAfterRelock = await erc20BalanceOf(LOCKING, ACCT0);
    // The top-up transferred exactly 1 more MENTO into the lock.
    expect(mentoAfterCreate - mentoAfterRelock).toBe(ONE_MENTO);
    // More MENTO locked for far longer => strictly more veMENTO voting weight.
    expect(veMentoAfterRelock > veMentoAfterCreate).toBe(true);
  } finally {
    clearInterval(miner);
  }
});
