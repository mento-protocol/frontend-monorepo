<!-- trunk-ignore-all(markdown-link-check) -->

# Wallet-Connected Testing (local anvil fork)

How to test connected-wallet flows (swap, approve, lock) in the local apps
without a real wallet or real funds. Works for AI agents and humans. Everything
runs against an anvil fork of Celo mainnet — no real network is ever touched.

## Prerequisites

- Foundry >= 1.4 (`anvil --celo` requires it). Install/update: `foundryup`.
- Node >= 22, `pnpm install` done.
- App env file: copy `apps/app.mento.org/.env.example` to
  `apps/app.mento.org/.env.local` and fill it — the env schema
  (`apps/app.mento.org/app/env.mjs`) fails the dev server at startup otherwise.
  `NEXT_PUBLIC_STORAGE_URL` must be a valid URL (real value: see the Vercel
  link in `.env.example`); `NEXT_PUBLIC_WALLET_CONNECT_ID`,
  `NEXT_PUBLIC_SENTRY_DSN_SWAP`, and `SENTRY_AUTH_TOKEN` must be present but
  may be empty strings for local dev (E2E mode replaces WalletConnect).
- `CHAINALYSIS_API_KEY` set in the same `.env.local` (any valid key; never
  commit it). Without it the app BLOCKS after wallet connect — the sanctions
  API route fails closed by design. See Troubleshooting.
- Docker (optional, only for the Otterscan block explorer).

## Quick start

1. Start the fork (leave running):

   ```bash
   pnpm fork:mainnet   # anvil --celo --auto-impersonate, Celo mainnet fork on port 8545
   ```

2. Seed it (fund test accounts, refresh oracle rates):

   ```bash
   pnpm fork:seed
   ```

   The summary table it prints includes each price feed's report expiry
   (`tokenReportExpirySeconds`) — re-run `pnpm fork:seed` whenever the fork has
   been up longer than the smallest expiry, or whenever quotes stall.

3. Start the app in E2E + fork mode:

   ```bash
   NEXT_PUBLIC_E2E_TEST=true NEXT_PUBLIC_USE_FORK=true pnpm exec turbo run dev --filter app.mento.org
   ```

   For governance flows (lock MENTO / voting power — the lock UI lives in
   `governance.mento.org`, not `app.mento.org`), start that app instead and use
   [http://localhost:3002/voting-power](http://localhost:3002/voting-power):

   ```bash
   NEXT_PUBLIC_E2E_TEST=true NEXT_PUBLIC_USE_FORK=true pnpm exec turbo run dev --filter governance.mento.org
   ```

   First run: copy `apps/governance.mento.org/.env.example` to
   `apps/governance.mento.org/.env.local` — governance validates its own env
   schema at startup. The example's prefilled URLs work as-is and the empty
   values (`NEXT_PUBLIC_GRAPH_API_KEY`, Sentry DSN) may stay empty for local
   E2E use; there is no sanctions gate here. Note: governance's `dev` script
   does not watch `@repo/web3` — after changing that package, run
   `pnpm exec turbo run build --filter @repo/web3` first (see Troubleshooting).

4. Open [http://localhost:3000](http://localhost:3000), click Connect — the modal shows only
   "E2E Test Wallet". Click it. You are connected as
   `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` (anvil junk account 0).

5. Drive the UI (e.g. swap 1 EURm -> USDm — native CELO is not a selectable
   swap token: the pinned mento-sdk's token map has no CELO entry for Celo
   mainnet, so `?from=CELO` silently falls back to the default pair), then
   verify on-chain (next section).

## Automated Playwright specs

Instead of driving the UI by hand, both apps have a `connected` Playwright
project that does steps 3-5 above automatically against the same seeded fork:
`pnpm --filter app.mento.org test:connected` (swap) and
`pnpm --filter governance.mento.org test:connected` (governance). See
`CLAUDE.md`'s "Connected-Wallet E2E" section for the exact build + run
commands per app.

The governance `connected` project has three specs:

- `e2e/connected/lock.spec.ts` — creates a MENTO lock and asserts the
  veMENTO/MENTO deltas on-chain.
- `e2e/connected/update-lock.spec.ts` — tops up **and** extends an existing
  lock through the `UpdateLockDialog` relock flow.
- `e2e/connected/proposal-lifecycle.spec.ts` — drives one serial happy-path
  proposal lifecycle (**create → vote → queue → execute**) through the real UI,
  asserting each transition on-chain (`Governor.state`) plus a concrete MENTO
  balance delta for the executed action. See the next section for its
  maintenance couplings and runtime cost.

### The subgraph-mock pattern (update-lock.spec.ts)

The update/relock flow's only UI entry is the "Update" button on a
`LockCard`, and `LockList` renders those cards exclusively from
`useGetLocksQuery` against the **live-mainnet** subgraph
(`NEXT_PUBLIC_SUBGRAPH_URL`, host `gateway.thegraph.com`). On the fork that
host is aborted by the network policy, so no card — and therefore no update
button — ever renders (this is the "mixed-state caveat" the lock specs
describe). Impersonating a real locked mainnet account is not an option: the
mock connector is hardcoded to anvil junk accounts, and live-subgraph vs
pinned-fork-block drift is non-deterministic.

`update-lock.spec.ts` therefore extends the network policy with one special
case: it creates a real lock on the fork, reads that lock's true parameters
out of the Locking contract's `LockCreate` event, and `route.fulfill()`s the
`getLocks` GraphQL operation with a **synthetic response built from that
on-chain state** — so `LockList` renders a card backed by a lock that
genuinely exists on the fork, and the relock transaction it drives is
fork-correct. Every other subgraph operation (proposals, withdrawals) is
answered with empty data. Success is still asserted **only** via the toast and
on-chain reads, never via the (mocked) card UI.

Maintenance coupling worth recording: the synthetic response is hand-shaped to
match `getLocks.graphql` / the generated `GetLocksQuery` type. If that query
gains or renames a selected field, the mock in `update-lock.spec.ts`
(`buildGetLocksResponse`) must be updated in lockstep. This subgraph-mock
technique is reusable for any future connected spec that needs a subgraph-fed
list to reflect fork state.

### The proposal-lifecycle spec (proposal-lifecycle.spec.ts)

`proposal-lifecycle.spec.ts` extends the same subgraph-mock pattern to the whole
governor lifecycle. It reuses `getLocks` (so the connected account's voting
power ungates the vote card) and additionally mocks **`getProposals`** (list)
and **`getProposal`** (detail), building the synthetic proposal object from fork
truth: the real on-chain `proposalId`, `targets/values/calldatas/description`,
`startBlock/endBlock` are read out of the Governor's `ProposalCreated` event
after the create transaction lands, and the client-side id is cross-checked by
re-deriving OZ `hashProposal` from those exact bytes. The mock is **mutated
between stages** — it grows a `proposalQueued[0].eta` after the queue step so the
Execute button ungates. Success is asserted **only** via toasts and on-chain
reads, never via the mocked list/detail UI.

Maintenance couplings specific to this spec:

- **Query shapes:** the two proposal mocks (`buildProposalResponse`) are
  hand-shaped to `getProposals.graphql` / `getProposal.graphql` +
  `proposalFields.graphql`. Renaming or adding a selected non-`@client` field
  requires updating the mock in lockstep (same cost as the `getLocks` mock).
- **votingPeriod storage slot:** to close the 691,200-block voting period
  cheaply, the spec shrinks `_votingPeriod` to 400 via `anvil_setStorageAt`. It
  does **not** hardcode the slot — it scans the Governor proxy for the slot
  holding the live `votingPeriod()` value and verifies the write with a
  read-back. If the Governor's storage layout changes, the scan self-heals or
  fails loudly; no manual slot to maintain. (Batch-mining the full period was
  benchmarked and rejected: empty-block mining recomputes state roots over
  forked Celo state at only ~18 blocks/s, and a single large `anvil_mine`
  batch — 2,000 blocks — reliably panics anvil in `do_mine_block`. The 400-block
  window is chosen to sit in the safe band: `votingDelay` is 0 so the deadline is
  `snapshot + 400`, which is ~2–4× the blocks the ~2–3 blocks/s background+CI
  interval miner consumes during the create→vote UI sequence — so the vote can't
  be crossed out of `Active` on a slow CI runner (the earlier 120 was too tight;
  `retries:0` makes any single overrun a red required check) — while the
  fast-forward that closes it stays a single ~350-block `anvil_mine` (~20s, well
  under the panic point; 500 blocks mine cleanly in ~27s). Its ~400s of
  chain-clock advance is immaterial: every assertion is block-based on-chain
  state, the status badge reads `Governor.state`, and no page in this flow reads
  SortedOracles.)
- **Timelock delay shrink:** before queue, the spec shrinks the
  TimelockController min-delay to 2s via the Timelock's self-only `updateDelay`
  (impersonating the Timelock calling itself) so the on-chain execute eta is
  reachable within the chain-vs-wall clock-skew budget. The UI execute gate
  compares the mocked `eta` against wall-clock `Date.now()`, so the mock's `eta`
  is set in the past independently.
- **Voting-power setup:** `proposalThreshold` (10,000 veMENTO) and quorum
  (≈2.29M veMENTO) are met out-of-band — the Timelock (the MENTO whale) transfers
  2×quorum MENTO to junk-0, which approves + locks it at max slope (104 weeks,
  self-delegated). This funding is spec-local (not in `fork-seed.mjs`).
- **Runtime cost:** ~3 minutes locally end-to-end (`test.setTimeout` is 480s as a
  ceiling; the time-travel is simulated, not waited out — most of the wall-clock
  is the ~350-block fast-forward mine at ~18 blocks/s plus the UI create→vote→
  queue→execute round-trips).

## Preview smoke

A separate, walletless smoke runs against REAL deployed Vercel previews
(real forno reads, no fork, no transactions) — no local anvil, no build
step. `.github/workflows/preview-smoke.yml` triggers on `deployment_status`
for team `*-mentolabs.vercel.app` previews of app.mento.org and
governance.mento.org, and runs
`PREVIEW_URL=<deployment url> pnpm --filter app.mento.org test:preview`
(config: `apps/app.mento.org/playwright.preview.config.ts`, spec:
`apps/app.mento.org/e2e/preview/smoke.spec.ts`). It checks that the deployed
bundle boots and lists the real wallet options, then that the mock wallet
can connect on a preview host. Run it locally against any live preview URL:

```bash
PREVIEW_URL=https://appmento-<hash>-mentolabs.vercel.app pnpm --filter app.mento.org test:preview
```

## Activation flags

Two equivalent activation paths. Env vars are read at build/dev-server start;
localStorage keys work on an already-running dev server (reload after setting).
The E2E wallet is hostname-allowlisted to `localhost` / `127.0.0.1` plus the
team's `*-mentolabs.vercel.app` Vercel previews — never production domains
— and enabled there for the same reason fork-mode debug knobs already are
(see below): the mock connector holds no keys, can't send unsigned
transactions through public RPCs, and its accounts are fixed public junk
addresses. Fork mode is NOT allowlisted the same way:
the `mento_use_fork` localStorage key is only ignored on production builds and
public `mento.org` hostnames (deny-list), and `NEXT_PUBLIC_USE_FORK=true`
applies wherever it is baked into the build — never set it for a deployed
build, or its Celo RPC points at `http://localhost:8545` and the app breaks.

| Purpose                   | Env var (start-time)        | localStorage key (runtime + reload)  |
| ------------------------- | --------------------------- | ------------------------------------ |
| Enable "E2E Test Wallet"  | `NEXT_PUBLIC_E2E_TEST=true` | `mento_e2e_wallet` = `"true"`        |
| Auto-connect on page load | —                           | `mento_e2e_eager_connect` = `"true"` |
| Point app RPC at the fork | `NEXT_PUBLIC_USE_FORK=true` | `mento_use_fork` = `"true"`          |

`mento_e2e_eager_connect` only works paired with `mento_use_fork`: it relies
on wagmi's reconnect-on-mount, which calls the mock connector's
`isAuthorized()` → an `eth_accounts` RPC call — the mock connector only
special-cases `eth_requestAccounts` (used by an explicit `connect()`), so
`eth_accounts` hits the real configured RPC. Public nodes (forno included)
return `[]` for `eth_accounts` (no unlocked accounts), so auto-reconnect
silently no-ops off the fork; only anvil answers it with real addresses.
Without the fork, connect explicitly (click the wallet in the modal) instead
of relying on eager-connect — see `e2e/preview/smoke.spec.ts` for the pattern.

localStorage path (paste in the browser console of a running dev server):

```js
localStorage.setItem("mento_e2e_wallet", "true");
localStorage.setItem("mento_e2e_eager_connect", "true");
localStorage.setItem("mento_use_fork", "true");
location.reload();
```

Test accounts (anvil junk accounts — public by design, NEVER fund on a real network):

- acct0 `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`
- acct1 `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`
- acct2 `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`

## Verifying transactions on-chain

Key Celo mainnet addresses (same on the fork):

- CELO `0x471EcE3750Da237f93B8E339c536989b8978a438`
- cUSD `0x765DE816845861e75A25fCA122bb6898B8B1282a`
- Mento Broker `0x777A8255cA72412f0d706dc03C9D1987306B4CaD`

Check a token balance:

```bash
cast call 0x765DE816845861e75A25fCA122bb6898B8B1282a \
  "balanceOf(address)(uint256)" 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
  --rpc-url http://127.0.0.1:8545
```

Check a transaction receipt (hash from the app's success toast or anvil logs):

```bash
cast receipt <TX_HASH> --rpc-url http://127.0.0.1:8545
```

Browse blocks/txs visually with Otterscan ([http://localhost:5100](http://localhost:5100)):

```bash
pnpm blockexplorer:start   # docker; stop with pnpm blockexplorer:stop
```

## Snapshot / revert discipline

```bash
cast rpc evm_snapshot --rpc-url http://127.0.0.1:8545          # returns an id, e.g. "0x0"
cast rpc evm_revert 0x0 --rpc-url http://127.0.0.1:8545        # returns true
```

- Snapshots are CONSUMED by revert — take a fresh snapshot after every revert.
- Re-run `pnpm fork:seed` after every `evm_revert` and whenever quotes stall
  (oracle staleness): revert rolls back seeded balances and oracle re-reports.

## Safety rules (NEVER list)

- NEVER commit or request real seed phrases or private keys. Only anvil's
  public junk accounts (above). NEVER fund those accounts on a real network.
- NEVER set `NEXT_PUBLIC_SANCTIONS_TEST_MODE=true` in wallet/E2E tooling — it
  force-BLOCKS the app (simulates a sanctioned wallet). It is not a bypass.
- NEVER weaken `apps/app.mento.org/app/api/sanctions/route.ts` — it fails
  closed without `CHAINALYSIS_API_KEY` by design.
- NEVER further loosen the E2E wallet's hostname allowlist beyond
  `localhost` / `127.0.0.1` / the anchored `*-mentolabs.vercel.app` pattern
  in `e2e-mode.ts` — extending it again requires the same no-keys/public
  junk-address rationale and an anchored regex reviewed for lookalike hosts.
- NEVER point fork tooling or the E2E wallet at a real network RPC.

## Troubleshooting

| Symptom                                                              | Cause / fix                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm fork:mainnet` fails: port 8545 in use                          | `lsof -i :8545`, kill the stale anvil, restart.                                                                                                                                                                                                                    |
| CELO transfers silently no-op on the fork                            | anvil started without `--celo` (manual command or pre-fix script). Use `pnpm fork:mainnet`.                                                                                                                                                                        |
| Swap quotes stall or swaps revert after the fork has been up a while | Oracle medians went stale (wall-clock expiry). Re-run `pnpm fork:seed`; if still stuck, restart the fork and re-seed.                                                                                                                                              |
| App shows a blocking screen right after connecting                   | Sanctions check failed closed — `CHAINALYSIS_API_KEY` missing from `apps/app.mento.org/.env.local`. Not a bug.                                                                                                                                                     |
| "E2E Test Wallet" not in the connect modal                           | Not on localhost/127.0.0.1, or neither `NEXT_PUBLIC_E2E_TEST=true` nor `mento_e2e_wallet` set, or you forgot to reload after setting localStorage.                                                                                                                 |
| governance.mento.org dev server has stale `@repo/web3`               | Its `dev` script does not watch `@repo/web3` (app.mento.org's does). Run `pnpm exec turbo run build --filter governance.mento.org` first.                                                                                                                          |
| Governance proposal or lock lists look inconsistent with fork state  | Proposal AND lock lists load from a live-mainnet subgraph, not the fork (`useLocksByAccount` queries the subgraph). Lock/approve transactions still execute on the fork — verify them on-chain with `cast` (section above) instead of trusting the rendered lists. |
