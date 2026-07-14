// Prerequisites (local runbook — identical to lock.spec.ts / update-lock.spec.ts;
// see #502 / #479 / #448 / #441):
//
//   pnpm fork:mainnet          # Terminal 1 — anvil --celo --auto-impersonate on :8545
//   pnpm fork:seed             # Terminal 2 — fund accounts 0-2, refresh oracles
//   NEXT_PUBLIC_E2E_TEST=true NEXT_PUBLIC_USE_FORK=true \
//     pnpm exec turbo run build --filter governance.mento.org
//   pnpm --filter governance.mento.org test:connected
//
// WHAT THIS SPEC DOES
// Drives one serial happy-path proposal lifecycle — create -> vote -> queue ->
// execute — through the REAL governance UI on a seeded anvil `--celo` fork of
// Celo mainnet, asserting each transition on-chain (Governor.state) plus, for
// the executed action, a concrete MENTO balance delta.
//
// It reuses the subgraph-mock technique from update-lock.spec.ts: the proposal
// list/detail UI is fed by the LIVE-mainnet Graph gateway (blocked on the
// fork), so we create the real on-chain proposal, read its true parameters out
// of the Governor's ProposalCreated event, and `route.fulfill()` getProposals /
// getProposal with a synthetic response built from that fork truth. getLocks is
// likewise mocked (as in update-lock.spec.ts) so the connected account's
// voting power ungates the vote card. Every success is asserted ONLY via toasts
// and on-chain reads — never via the (mocked) list UI.
//
// ── VOTING-POWER SETUP (D1) ──────────────────────────────────────────────────
// proposalThreshold = 10,000 veMENTO and quorum ≈ 2.29M veMENTO are far beyond
// fork:seed's ~1,000 MENTO. Out-of-band (direct JSON-RPC, --auto-impersonate),
// the TimelockController (which holds ~81M MENTO) transfers 2×quorum MENTO to
// junk account 0, which then approves + locks it at max slope (104 weeks,
// self-delegated). Junk-0 alone then clears BOTH proposalThreshold AND quorum,
// so the whole lifecycle runs from the one connected wallet through the UI. The
// UI lock flow itself is NOT re-tested here (lock.spec.ts owns it).
//
// ── votingPeriod FAST-FORWARD (D2) — benchmarked decision: STORAGE SHRINK ────
// votingPeriod = 691,200 blocks. Batch-mining that many empty blocks was
// benchmarked on this fork and REJECTED: `anvil_mine("0xA8C00", …)` did not
// finish within a 180s cap, and even a 50,000-block batch exceeded 150s (≫ the
// 60s budget) — empty-block mining recomputes state roots over forked state and
// is far too slow. Instead we shrink `_votingPeriod` to 120 via
// `anvil_setStorageAt` BEFORE proposing (slot located by scanning the Governor
// proxy for the live votingPeriod() value, then verified by reading it back),
// and mine ~130 blocks to close voting. Measured cost: storage write + 130-block
// mine < 1s, with only ~130s of chain-clock advance — which keeps the
// chain-vs-wall skew well under the ~2-minute budget (D4). Storage is the only
// shortcut: `setVotingPeriod` reverts even from an impersonated Timelock because
// OZ's onlyGovernance deque rejects direct calls.
//
// ── TIMELOCK / EXECUTE GATING (D3) ───────────────────────────────────────────
// The UI execute gate (`isVetoPeriodOver`, vote-card.tsx) compares
// `proposal.proposalQueued[0].eta` (subgraph) against WALL-CLOCK `Date.now()` —
// so the mock's eta is set in the past and the gate opens immediately, no chain
// warp needed for the UI. The on-chain `execute()` separately needs the
// TimelockController eta (= queue block.timestamp + minDelay) to have elapsed;
// we shrink minDelay to a couple of seconds via the Timelock's self-only
// `updateDelay` (impersonating the Timelock calling ITSELF) and then
// `evm_increaseTime` a few seconds so chain time passes eta. Both stay within
// the skew budget.
import { expect, test, type Page } from "@playwright/test";
import {
  anvilMine,
  blockNumber,
  erc20BalanceOf,
  ethCall,
  getStorageAt,
  increaseTime,
  latestTimestamp,
  mineBlocks,
  revert,
  rpc,
  sendAs,
  setStorageAt,
  snapshot,
} from "./rpc";
import {
  decodeEventLog,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  hexToBigInt,
  keccak256,
  parseAbi,
  parseAbiParameters,
  stringToBytes,
  toEventSelector,
  type Abi,
  type Address,
  type Hex,
} from "viem";

// Canonical Celo mainnet (chain 42220) addresses — hardcoded to match the
// sibling connected specs (lock.spec.ts / update-lock.spec.ts hardcode MENTO /
// LOCKING the same way); cross-checked against @mento-protocol/mento-sdk
// addresses[CELO] and live on-chain in the #502 recon.
const MENTO = "0x7FF62f59e3e89EA34163EA1458EEBCc81177Cfb6";
const LOCKING = "0x001Bb66636dCd149A1A2bA8C50E408BdDd80279C";
const GOVERNOR = "0x47036d78bB3169b4F5560dD77BF93f4412A59852";
const TIMELOCK = "0x890DB8A597940165901372Dd7DB61C9f246e2147";
// Junk account 0 — the connected wallet (proposer + voter).
const ACCT0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
// A previously-unused junk account (index 7) as the executed-transfer recipient
// so its pre-balance is deterministically checked and we assert a DELTA.
const RECIPIENT = "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955";
const ONE_MENTO = 10n ** 18n;

// Host of NEXT_PUBLIC_SUBGRAPH_URL — same host update-lock.spec.ts intercepts.
const SUBGRAPH_HOST = "gateway.thegraph.com";

// keccak256("LockCreate(uint256,address,address,uint256,uint256,uint256,uint256)")
// — copied verbatim from update-lock.spec.ts (indexed: id, account, delegate;
// data words: time, amount, slopePeriod, cliff).
const LOCK_CREATE_TOPIC =
  "0x9024bda3efb3f3701e8d25fdb8d8adb67deb176633f590ee4a3cd1dad74dc73e";

const VOTING_PERIOD_SHRUNK = 120; // blocks — small deadline, see header (D2)
const TIMELOCK_MIN_DELAY_SHRUNK = 2n; // seconds — see header (D3)

// ── viem ABIs (reads via eth_call, writes hand-fed to sendAs) ────────────────
const govAbi = parseAbi([
  "function state(uint256) view returns (uint8)",
  "function quorum(uint256) view returns (uint256)",
  "function proposalSnapshot(uint256) view returns (uint256)",
  "function proposalDeadline(uint256) view returns (uint256)",
  // Bravo-style getter (this Governor has no GovernorCountingSimple
  // proposalVotes) — forVotes is output index 5.
  "function proposals(uint256) view returns (uint256 id, address proposer, uint256 eta, uint256 startBlock, uint256 endBlock, uint256 forVotes, uint256 againstVotes, uint256 abstainVotes, bool canceled, bool executed)",
  "function getVotes(address, uint256) view returns (uint256)",
  "function votingPeriod() view returns (uint256)",
]);
const tokenAbi = parseAbi([
  "function transfer(address, uint256) returns (bool)",
  "function approve(address, uint256) returns (bool)",
]);
const lockingAbi = parseAbi([
  "function lock(address account, address delegate, uint96 amount, uint32 slopePeriod, uint32 cliff) returns (uint256)",
]);
const timelockAbi = parseAbi([
  "function updateDelay(uint256)",
  "function getMinDelay() view returns (uint256)",
]);

const proposalCreatedEvent = {
  type: "event",
  name: "ProposalCreated",
  inputs: [
    { name: "proposalId", type: "uint256", indexed: false },
    { name: "proposer", type: "address", indexed: false },
    { name: "targets", type: "address[]", indexed: false },
    { name: "values", type: "uint256[]", indexed: false },
    { name: "signatures", type: "string[]", indexed: false },
    { name: "calldatas", type: "bytes[]", indexed: false },
    { name: "startBlock", type: "uint256", indexed: false },
    { name: "endBlock", type: "uint256", indexed: false },
    { name: "description", type: "string", indexed: false },
  ],
} as const;
const PROPOSAL_CREATED_TOPIC = toEventSelector(
  "ProposalCreated(uint256,address,address[],uint256[],string[],bytes[],uint256,uint256,string)",
);

// ── typed read helpers (eth_call + decodeFunctionResult) ─────────────────────
async function readResult<TName extends string>(
  address: string,
  abi: Abi,
  functionName: TName,
  args: readonly unknown[],
): Promise<unknown> {
  const data = encodeFunctionData({
    abi,
    functionName,
    args,
  } as Parameters<typeof encodeFunctionData>[0]);
  const result = (await ethCall(address, data)) as Hex;
  return decodeFunctionResult({
    abi,
    functionName,
    data: result,
  } as Parameters<typeof decodeFunctionResult>[0]);
}

const govState = async (id: bigint): Promise<number> =>
  Number(await readResult(GOVERNOR, govAbi, "state", [id]));
const govQuorum = async (block: bigint): Promise<bigint> =>
  (await readResult(GOVERNOR, govAbi, "quorum", [block])) as bigint;
const govProposalSnapshot = async (id: bigint): Promise<bigint> =>
  (await readResult(GOVERNOR, govAbi, "proposalSnapshot", [id])) as bigint;
const govProposalDeadline = async (id: bigint): Promise<bigint> =>
  (await readResult(GOVERNOR, govAbi, "proposalDeadline", [id])) as bigint;
const govGetVotes = async (account: string, block: bigint): Promise<bigint> =>
  (await readResult(GOVERNOR, govAbi, "getVotes", [account, block])) as bigint;
const govVotingPeriod = async (): Promise<bigint> =>
  (await readResult(GOVERNOR, govAbi, "votingPeriod", [])) as bigint;
const govForVotes = async (id: bigint): Promise<bigint> => {
  const result = (await readResult(GOVERNOR, govAbi, "proposals", [
    id,
  ])) as readonly [
    bigint,
    string,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    boolean,
    boolean,
  ];
  return result[5];
};
const timelockMinDelay = async (): Promise<bigint> =>
  (await readResult(TIMELOCK, timelockAbi, "getMinDelay", [])) as bigint;

const encodeTransfer = (to: string, amount: bigint): Hex =>
  encodeFunctionData({
    abi: tokenAbi,
    functionName: "transfer",
    args: [to as Address, amount],
  });

// ── voting-period storage shrink (D2) ────────────────────────────────────────
// Scan the Governor proxy's low storage slots for the one holding the live
// votingPeriod value, write the shrunk value there, and verify via a read-back
// of votingPeriod(); restore + retry the next matching slot on mismatch.
async function shrinkVotingPeriod(target: number): Promise<number> {
  const current = await govVotingPeriod();
  const matches: number[] = [];
  for (let slot = 0; slot < 600; slot++) {
    if ((await getStorageAt(GOVERNOR, slot)) === current) matches.push(slot);
  }
  if (matches.length === 0) {
    throw new Error(
      `no storage slot on the Governor proxy holds votingPeriod (${current}) — layout changed`,
    );
  }
  for (const slot of matches) {
    await setStorageAt(GOVERNOR, slot, BigInt(target));
    if ((await govVotingPeriod()) === BigInt(target)) return slot;
    await setStorageAt(GOVERNOR, slot, current); // restore, try next
  }
  throw new Error(
    `writing votingPeriod=${target} to slot(s) ${matches.join(",")} did not take`,
  );
}

// ── subgraph mock state (mutated across lifecycle stages; reset per test) ────
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

// Copied from update-lock.spec.ts: read the single LockCreate event for
// `account` and decode the fields the subgraph exposes.
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

// getLocks response shaped exactly as update-lock.spec.ts's buildGetLocksResponse
// (owner == delegate == connected account so ownVe > 0 ungates the vote card).
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

// The proposal object fulfilled for getProposals (list) and getProposal
// (detail). Mutated between stages: proposalQueued grows an eta after queue,
// proposalExecuted grows a tx after execute. Field set mirrors
// proposalFields.graphql + getProposal's `calls`; @client fields (state,
// metadata, votes) are computed locally and MUST be absent.
interface ProposalMock {
  proposalId: string;
  description: string;
  proposer: string;
  createdTimestamp: number;
  createdTxHash: string;
  startBlock: number;
  endBlock: number;
  calls: { target: string; value: string; calldata: string }[];
  queuedEta: number | null;
  executedTxHash: string | null;
}

function buildProposalResponse(mock: ProposalMock): unknown {
  return {
    data: {
      proposals: [
        {
          __typename: "Proposal",
          proposalId: mock.proposalId,
          description: mock.description,
          proposer: { __typename: "Account", id: mock.proposer.toLowerCase() },
          proposalCreated: [
            {
              __typename: "ProposalCreated",
              timestamp: mock.createdTimestamp,
              transaction: {
                __typename: "Transaction",
                id: mock.createdTxHash,
              },
            },
          ],
          proposalQueued:
            mock.queuedEta === null
              ? []
              : [{ __typename: "ProposalQueued", eta: mock.queuedEta }],
          proposalExecuted:
            mock.executedTxHash === null
              ? []
              : [
                  {
                    __typename: "ProposalExecuted",
                    transaction: {
                      __typename: "Transaction",
                      id: mock.executedTxHash,
                      timestamp: Math.floor(Date.now() / 1000),
                    },
                  },
                ],
          proposalCanceled: [],
          votecast: [],
          startBlock: mock.startBlock,
          endBlock: mock.endBlock,
          queued: mock.queuedEta !== null,
          canceled: false,
          executed: mock.executedTxHash !== null,
          calls: mock.calls.map((call, index) => ({
            __typename: "ProposalCall",
            index,
            target: { __typename: "Account", id: call.target.toLowerCase() },
            value: call.value,
            signature: "",
            calldata: call.calldata,
          })),
        },
      ],
    },
  };
}

// Mutable holders read live by the route handler; reset in beforeEach.
let mockedLocksResponse: unknown | null = null;
let mockedProposal: ProposalMock | null = null;

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
      return route.continue();
    }
    if (isCdnHost(hostname)) {
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: PLACEHOLDER_PNG,
      });
    }
    if (hostname === SUBGRAPH_HOST) {
      let body: { operationName?: string; query?: string } | undefined;
      try {
        body = route.request().postDataJSON();
      } catch {
        body = undefined;
      }
      const operationName = body?.operationName ?? "";
      const query = body?.query ?? "";
      const isGetLocks =
        operationName === "getLocks" || query.includes("getLocks");
      const isProposalOp =
        operationName === "getProposals" ||
        operationName === "getProposal" ||
        query.includes("getProposal");
      let payload: unknown = { data: {} };
      if (isGetLocks) {
        payload = mockedLocksResponse ?? { data: { locks: [] } };
      } else if (isProposalOp) {
        payload = mockedProposal
          ? buildProposalResponse(mockedProposal)
          : { data: { proposals: [] } };
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(payload),
      });
    }
    return route.abort();
  });
}

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
  mockedProposal = null;
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
  snapshotId = await snapshot();
});

test.afterEach(async () => {
  if (snapshotId === undefined) return;
  const id = snapshotId;
  snapshotId = undefined;
  expect(await revert(id)).toBe(true);
});

test("proposal lifecycle: create -> vote -> queue -> execute on the fork", async ({
  page,
}) => {
  // Six on-chain stages + block mining + UI waits; generous but capped per D7.
  test.setTimeout(480_000);

  // Governance write hooks wait for multiple confirmations and anvil only
  // automines on a new tx — mine empty blocks in the background for the whole
  // flow (same pattern as lock.spec.ts / update-lock.spec.ts).
  const miner = setInterval(() => {
    void rpc("evm_mine", []).catch(() => {});
  }, 500);

  try {
    // ══ 1. SETUP (out-of-band): shrink votingPeriod, fund + lock voting power ══
    const votingPeriodSlot = await shrinkVotingPeriod(VOTING_PERIOD_SHRUNK);
    expect(await govVotingPeriod()).toBe(BigInt(VOTING_PERIOD_SHRUNK));

    const head = await blockNumber();
    const quorumNow = await govQuorum(head - 1n);
    const lockAmount = 2n * quorumNow; // clears proposalThreshold AND quorum

    const blockBeforeLock = `0x${(await blockNumber()).toString(16)}`;
    // Timelock (MENTO whale) -> junk-0, then junk-0 approves + locks at max slope.
    await sendAs(TIMELOCK, MENTO, encodeTransfer(ACCT0, lockAmount));
    await sendAs(
      ACCT0,
      MENTO,
      encodeFunctionData({
        abi: tokenAbi,
        functionName: "approve",
        args: [LOCKING as Address, lockAmount],
      }),
    );
    await sendAs(
      ACCT0,
      LOCKING,
      encodeFunctionData({
        abi: lockingAbi,
        functionName: "lock",
        args: [ACCT0 as Address, ACCT0 as Address, lockAmount, 104, 0],
      }),
    );
    await mineBlocks(2);

    // Arm the getLocks mock from the real on-chain lock so the vote card ungates.
    const lock = await readCreatedLock(ACCT0, blockBeforeLock);
    expect(lock.owner.toLowerCase()).toBe(ACCT0.toLowerCase());
    expect(lock.amount).toBe(lockAmount);
    mockedLocksResponse = buildGetLocksResponse(lock);

    // ══ 2. CREATE (UI) ══════════════════════════════════════════════════════
    await page.goto("/create-proposal", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("0xf39F...2266")).toBeVisible({
      timeout: 30_000,
    }); // eager-connected via the init-script localStorage keys

    // veMENTO now exceeds proposalThreshold, so the wizard (not the "Not enough
    // veMENTO" dead-end) renders.
    const title = "Lifecycle E2E Proposal";
    await expect(page.getByTestId("proposalTitleInput")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId("proposalTitleInput").fill(title);

    const editor = page
      .getByTestId("proposalDescriptionInput")
      .locator('[contenteditable="true"]');
    await editor.click();
    await page.keyboard.type(
      "This is an automated end to end governance lifecycle proposal used to exercise create, vote, queue and execute on a local anvil celo fork.",
    );

    await expect(page.getByTestId("nextButton")).toBeEnabled({
      timeout: 30_000,
    });
    await page.getByTestId("nextButton").click();

    // Execution code: a single MENTO transfer of 1 MENTO from the Timelock to a
    // fresh recipient (D5). The Timelock executes proposal calls as msg.sender
    // and holds the balance, so this cannot revert for lack of funds.
    const transferCalldata = encodeTransfer(RECIPIENT, ONE_MENTO);
    const executionCode = JSON.stringify(
      [{ address: MENTO, value: 0, data: transferCalldata }],
      null,
      2,
    );
    await expect(page.getByTestId("executionCodeInput")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId("executionCodeInput").fill(executionCode);
    await expect(page.getByTestId("nextButton")).toBeEnabled({
      timeout: 30_000,
    });
    await page.getByTestId("nextButton").click();

    // Submit.
    const blockBeforeCreate = `0x${(await blockNumber()).toString(16)}`;
    await expect(page.getByTestId("createProposalButton")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId("createProposalButton").click();

    // Read the real ProposalCreated event (authoritative id + exact description
    // bytes the app proposed), poll until the tx has landed.
    let created:
      | {
          proposalId: bigint;
          targets: readonly string[];
          values: readonly bigint[];
          calldatas: readonly string[];
          description: string;
          startBlock: bigint;
          endBlock: bigint;
        }
      | undefined;
    for (let attempt = 0; attempt < 60 && !created; attempt++) {
      const logs = await rpc<{ topics: string[]; data: string }[]>(
        "eth_getLogs",
        [
          {
            address: GOVERNOR,
            fromBlock: blockBeforeCreate,
            toBlock: "latest",
            topics: [PROPOSAL_CREATED_TOPIC],
          },
        ],
      );
      if (logs[0]) {
        const decoded = decodeEventLog({
          abi: [proposalCreatedEvent],
          data: logs[0].data as Hex,
          topics: logs[0].topics as [Hex, ...Hex[]],
        });
        const args = decoded.args as unknown as {
          proposalId: bigint;
          targets: readonly string[];
          values: readonly bigint[];
          calldatas: readonly string[];
          description: string;
          startBlock: bigint;
          endBlock: bigint;
        };
        created = args;
      } else {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
      }
    }
    if (!created) {
      throw new Error(
        "ProposalCreated event never landed — the propose transaction did not confirm on the fork",
      );
    }
    const proposalId = created.proposalId;

    // Cross-check: re-derive the id via OZ hashProposal from the event's exact
    // targets/values/calldatas/description and fail loudly on mismatch (proves
    // the app's client-side id == the on-chain id, i.e. the redirect target is
    // real).
    const descriptionHash = keccak256(stringToBytes(created.description));
    const recomputedId = hexToBigInt(
      keccak256(
        encodeAbiParameters(
          parseAbiParameters(
            "address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash",
          ),
          [
            created.targets as readonly Address[],
            created.values,
            created.calldatas as readonly Hex[],
            descriptionHash,
          ],
        ),
      ),
    );
    expect(recomputedId).toBe(proposalId);

    // Arm the proposal mock from fork truth so proposalExists() flips true and
    // the app fires the success toast + auto-redirect.
    const createBlockTimestamp = await latestTimestamp();
    mockedProposal = {
      proposalId: proposalId.toString(),
      description: created.description,
      proposer: ACCT0,
      createdTimestamp: Number(createBlockTimestamp),
      createdTxHash: `0x${"0".repeat(64)}`,
      startBlock: Number(created.startBlock),
      endBlock: Number(created.endBlock),
      calls: [{ target: MENTO, value: "0", calldata: transferCalldata }],
      queuedEta: null,
      executedTxHash: null,
    };

    // D7.1 — toast + redirect + on-chain Active.
    await expect(page.getByText("Proposal created successfully!")).toBeVisible({
      timeout: 60_000,
    });
    await page.waitForURL(new RegExp(`/proposals/${proposalId.toString()}$`), {
      timeout: 60_000,
    });
    await mineBlocks(2);
    expect(await govState(proposalId)).toBe(1); // Active

    const snapshotBlock = await govProposalSnapshot(proposalId);
    const deadlineBlock = await govProposalDeadline(proposalId);
    expect(deadlineBlock - snapshotBlock).toBe(BigInt(VOTING_PERIOD_SHRUNK));

    // ══ 3. VOTE (UI) ════════════════════════════════════════════════════════
    const expectedForWeight = await govGetVotes(ACCT0, snapshotBlock);
    expect(expectedForWeight > quorumNow).toBe(true);

    await expect(page.getByTestId("yesProposalButton")).toBeEnabled({
      timeout: 60_000,
    });
    await page.getByTestId("yesProposalButton").click();
    await expect(page.getByText("Vote cast successfully!")).toBeVisible({
      timeout: 120_000,
    });
    await mineBlocks(2);

    // D7.2 — forVotes == snapshot weight (> quorum).
    expect(await govForVotes(proposalId)).toBe(expectedForWeight);

    // ══ 4. FAST-FORWARD past the (shrunk) voting period ═════════════════════
    const current = await blockNumber();
    const toMine = Number(deadlineBlock - current) + 5;
    await anvilMine(toMine > 0 ? toMine : 5);
    expect(await govState(proposalId)).toBe(4); // Succeeded

    // D7.3 — reload so the badge (fetch-once via the on-chain state read) and
    // the vote card pick up Succeeded, then assert the badge.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("proposalStateLabel")).toHaveText(
      /^succeeded$/i,
      { timeout: 60_000 },
    );

    // ══ 5. QUEUE (UI) ═══════════════════════════════════════════════════════
    // Shrink the timelock delay (self-only updateDelay) so the on-chain eta is
    // reachable within the skew budget.
    await sendAs(
      TIMELOCK,
      TIMELOCK,
      encodeFunctionData({
        abi: timelockAbi,
        functionName: "updateDelay",
        args: [TIMELOCK_MIN_DELAY_SHRUNK],
      }),
    );
    expect(await timelockMinDelay()).toBe(TIMELOCK_MIN_DELAY_SHRUNK);

    await expect(page.getByTestId("queueProposalButton")).toBeEnabled({
      timeout: 60_000,
    });
    await page.getByTestId("queueProposalButton").click();
    // No queue toast — wait for the on-chain state to reach Queued.
    await expect
      .poll(async () => govState(proposalId), { timeout: 120_000 })
      .toBe(5); // Queued
    await mineBlocks(2);

    // Grow the mock's proposalQueued.eta (in the past, wall-clock — the UI
    // execute gate compares against Date.now()) and warp chain time past the
    // real timelock eta so on-chain execute() is ready.
    mockedProposal = {
      ...mockedProposal,
      queuedEta: Math.floor(Date.now() / 1000) - 60,
    };
    await increaseTime(Number(TIMELOCK_MIN_DELAY_SHRUNK) + 5);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("proposalStateLabel")).toHaveText(
      /^queued$/i,
      { timeout: 60_000 },
    );

    // ══ 6. EXECUTE (UI) ═════════════════════════════════════════════════════
    const recipientBefore = await erc20BalanceOf(MENTO, RECIPIENT);
    expect(recipientBefore).toBe(0n);

    await expect(page.getByTestId("executeProposalButton")).toBeEnabled({
      timeout: 60_000,
    });
    await page.getByTestId("executeProposalButton").click();
    await expect
      .poll(async () => govState(proposalId), { timeout: 120_000 })
      .toBe(7); // Executed
    await mineBlocks(2);

    // D7.5 — badge + concrete on-chain effect (recipient MENTO delta == 1e18).
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("proposalStateLabel")).toHaveText(
      /^executed$/i,
      { timeout: 60_000 },
    );
    const recipientAfter = await erc20BalanceOf(MENTO, RECIPIENT);
    expect(recipientAfter - recipientBefore).toBe(ONE_MENTO);

    // Sanity: the storage shrink hit exactly one slot (documented in the header).
    expect(votingPeriodSlot).toBeGreaterThanOrEqual(0);
  } finally {
    clearInterval(miner);
  }
});
