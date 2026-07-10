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

4. Open [http://localhost:3000](http://localhost:3000), click Connect — the modal shows only
   "E2E Test Wallet". Click it. You are connected as
   `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` (anvil junk account 0).

5. Drive the UI (e.g. swap 1 CELO -> cUSD), then verify on-chain (next section).

## Automated Playwright specs

Instead of driving the UI by hand, both apps have a `connected` Playwright
project that does steps 3-5 above automatically against the same seeded fork:
`pnpm --filter app.mento.org test:connected` (swap) and
`pnpm --filter governance.mento.org test:connected` (create a MENTO lock). See
`CLAUDE.md`'s "Connected-Wallet E2E" section for the exact build + run
commands per app.

## Activation flags

Two equivalent activation paths. Env vars are read at build/dev-server start;
localStorage keys work on an already-running dev server (reload after setting).
The E2E wallet is hostname-allowlisted to `localhost` / `127.0.0.1` and cannot
be enabled on deployed hostnames. Fork mode is NOT allowlisted the same way:
the `mento_use_fork` localStorage key is only ignored on production builds and
public `mento.org` hostnames (deny-list), and `NEXT_PUBLIC_USE_FORK=true`
applies wherever it is baked into the build — never set it for a deployed
build, or its Celo RPC points at `http://localhost:8545` and the app breaks.

| Purpose                   | Env var (start-time)        | localStorage key (runtime + reload)  |
| ------------------------- | --------------------------- | ------------------------------------ |
| Enable "E2E Test Wallet"  | `NEXT_PUBLIC_E2E_TEST=true` | `mento_e2e_wallet` = `"true"`        |
| Auto-connect on page load | —                           | `mento_e2e_eager_connect` = `"true"` |
| Point app RPC at the fork | `NEXT_PUBLIC_USE_FORK=true` | `mento_use_fork` = `"true"`          |

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
- NEVER loosen the E2E wallet's localhost hostname allowlist.
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
