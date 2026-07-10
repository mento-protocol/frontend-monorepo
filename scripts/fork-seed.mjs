#!/usr/bin/env node
/**
 * Seeds a local anvil `--celo` fork of Celo mainnet for wallet-gated E2E
 * testing (see #441 / #442):
 *
 *   1. Funds the anvil junk accounts (mnemonic `test test ... junk`) with
 *      10,000 native CELO each via `anvil_setBalance`.
 *   2. Tops each junk account up to >= 1,000 units of cUSD, cEUR, USDC, and
 *      MENTO by impersonating a mainnet whale per token and transferring.
 *   3. Re-reports every SortedOracles median so Broker quotes don't revert on
 *      stale reports — both the chainlink-relayer feeds (impersonating each
 *      relayer) and the legacy-token feeds (impersonating the oracles
 *      returned by getOracles(rateFeedId); see #452).
 *
 * Idempotent: token funding is skipped once a recipient already holds the
 * target balance; oracle re-reporting is safe to repeat (same median, fresh
 * timestamp). Whale/relayer transfers explicitly impersonate + fund gas, so
 * the script also works if anvil is ever started without `--auto-impersonate`.
 *
 * Zero-dependency: plain Node >= 22 built-ins + native fetch, raw JSON-RPC to
 * the fork. No viem/ethers — calldata is hand-encoded (see the ENCODE
 * helpers below), ported from the fork-data-prep playbook in
 * `mento-protocol/mento-automation-tests` (whale funding + impersonated-
 * relayer SortedOracles re-reporting).
 *
 * Run: `pnpm fork:seed` (requires `pnpm fork:mainnet` running first)
 */

import process from "node:process";
import { pathToFileURL } from "node:url";

// ── configuration ────────────────────────────────────────────────────────────

// Override target for pointing at a non-default anvil port/host; not a turbo
// pipeline input.
// eslint-disable-next-line turbo/no-undeclared-env-vars
const RPC_URL = process.env["FORK_RPC_URL"] ?? "http://127.0.0.1:8545";
const CELO_MAINNET_CHAIN_ID = "0xa4ec"; // 42220

// Anvil's well-known junk accounts (mnemonic `test test test test test test
// test test test test test junk`). Public by design — never real key
// material, never used on a real network.
const ANVIL_ACCOUNTS = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", // acct0
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", // acct1
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", // acct2
];

const CELO = "0x471EcE3750Da237f93B8E339c536989b8978a438"; // native + ERC-20 duality with --celo

// symbol, token address, decimals, whale to impersonate (balances verified
// against Celo mainnet 2026-07-09; whale balances drift, hence the runtime
// check in fundTokens()).
const TOKENS = [
  {
    symbol: "cUSD",
    address: "0x765DE816845861e75A25fCA122bb6898B8B1282a",
    decimals: 18,
    whale: "0xB5BBea2325a8f5a0130a1Aaa372bA768F1C62c43",
  },
  {
    symbol: "cEUR",
    address: "0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73",
    decimals: 18,
    // The cEUR contract itself holds ~408,000 mis-sent cEUR — intentional,
    // not a typo.
    whale: "0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73",
  },
  {
    symbol: "USDC",
    address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
    decimals: 6, // NOTE: 6 decimals, not 18
    whale: "0x9380fA34Fd9e4Fd14c06305fd7B6199089eD4eb9",
  },
  {
    symbol: "MENTO",
    address: "0x7FF62f59e3e89EA34163EA1458EEBCc81177Cfb6",
    decimals: 18,
    whale: "0x890DB8A597940165901372Dd7DB61C9f246e2147", // Mento Governance Timelock
  },
];

const SORTED_ORACLES = "0xefb84935239dacdecf7c5ba76d8de40b077b7b33";

// Chainlink relayer per rate-feed pair. The rateFeedId for each pair is NOT a
// constant — it is resolved on-chain per relayer (see resolveRateFeedId).
const RELAYERS = {
  aud_usd: "0xA8869Bb55d1082D12c8F993A56cE8D050551a3d9",
  brl_usd: "0x6322A90B468C14d1091CC91bC42FAd5584312220",
  cad_usd: "0x3a7af4E6f53ac13BC9e67Cb6ed5866d855692390",
  celo_aud: "0x50DA4b658076B86970EC6e6650823B4A24E7026f",
  celo_cad: "0x98aB92521fd13026292Cb6B31229ADf3B60fAE56",
  celo_chf: "0x09B310c2D4b0CDCE563762C0e3992e352Cacdda6",
  celo_cop: "0x5926F76D43Ce2D778880226b3C4e7156C8Ece99e",
  celo_eth: "0xd5bAF8D2072B2dB54Bed9c4763D591a44C408A98",
  celo_gbp: "0x3E3e3E04a4d4654042CB7f0efe10DeF73Fda6223",
  celo_ghs: "0xC7fFB4F9b377472075705A4f5347B618c527ECc2",
  celo_jpy: "0x522D100Ce28b150fBfcB90551d8822789ff53886",
  celo_kes: "0x698Ac749cF4Eb5E9E8D903e2F222275E53416B54",
  celo_ngn: "0x75Ba8f6855e54F36282067b185f2b9c0baC8A588",
  celo_php: "0x8Ec42cd1F5F41EAA8701a0a246cD76Fc7543EA8E",
  celo_xof: "0x242631D81A6eb2516a2A51C31240929d514Ea202",
  celo_zar: "0x28EFfAbD76589Dd822F41e79C965c74Ab9d27160",
  chf_usd: "0x1b904277b22cA598ef17b38f64De5F9C29cd31BD",
  cop_usd: "0x783F947126Adb7646c2A459B867f5B526D2E6603",
  eur_usd: "0xC4918A76A7fdB113f2dFa9B162e875f271A2f7b8",
  eur_xof: "0x22e78caFCD7eaDD7907328Be22E0C6D66Ce363B3",
  gbp_usd: "0x215d3ba962597DeFb38Da439ED4dB8E8a63e409a",
  ghs_usd: "0x1485C0E710ff9EF059834F42b312F10e7af823bd",
  jpy_usd: "0x1327A32fA7e3a0C3c0a5828D4f3ff16CE9E13Ee9",
  kes_usd: "0x4920101408D129a1A7B33fB0ECA4FB0233FD00D4",
  ngn_usd: "0xce35D1F69523a0672b9281dF1675D5b5D4004feF",
  php_usd: "0x3bC1f31B8150dc65B9fB9E8B69604C40EaA97C2F",
  usdt_usd: "0x564dD5fec58E7103C2A6041B7dD1BB3074a4616b",
  xof_usd: "0xF2772e9EF0C1bc2794f7c21cf35843391bC32A5A",
  zar_usd: "0x4FF9042aF59AF2B507b9423bE385f664FF87F7af",
};

// Legacy-token rate feeds NOT covered by the RELAYERS map above (#452): their
// rateFeedId is a fixed address (the stable-token address for the CELO/*
// feeds, a dedicated feed address for the rest) and their oracle set is
// discovered on-chain via SortedOracles.getOracles(rateFeedId) instead of a
// hardcoded relayer, so this list self-heals when oracles rotate. Without
// re-reporting these, routes through the cUSD/USDC or cEUR/axlEUROC pools
// revert once the fork's chain time passes the feed expiry (360s) — exactly
// what broke the connected swap spec in CI (PR #456 runs 29062599607 and
// 29063029354: USDC/USD and EUROC/EUR were 176s old at fork block 71727341).
const LEGACY_RATE_FEEDS = {
  celo_usd: "0x765DE816845861e75A25fCA122bb6898B8B1282a", // rateFeedId = cUSD
  celo_eur: "0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73", // rateFeedId = cEUR
  celo_brl: "0xe8537a3d056DA446677B9E9d6c5dB704EaAb4787", // rateFeedId = cREAL
  usdc_usd: "0xA1A8003936862E7a15092A91898D69fa8bCE290c",
  usdc_eur: "0x206B25Ea01E188Ee243131aFdE526bA6E131a016",
  usdc_brl: "0x25F21A1f97607Edf6852339fad709728cffb9a9d",
  euroc_eur: "0x26076B9702885d475ac8c3dB3Bd9F250Dc5A318B",
  euroc_xof: "0xed35e46b095197da30ddffa5b91d386886d5ce0d",
};

// Function selectors (keccak-256 of the canonical signature, first 4 bytes).
const SEL = {
  transfer: "0xa9059cbb", // transfer(address,uint256)
  balanceOf: "0x70a08231", // balanceOf(address)
  report: "0x80e50744", // report(address,uint256,address,address)
  medianRate: "0xef90e1b0", // medianRate(address)
  tokenReportExpirySeconds: "0x2e86bc01", // tokenReportExpirySeconds(address)
  reportExpirySeconds: "0x493a353c", // reportExpirySeconds()
  rateFeedId: "0xa1bd91da", // rateFeedId()
  getOracles: "0x8e749281", // getOracles(address)
};

const TARGET_ACCOUNT_CELO = 10_000n * 10n ** 18n;
const GAS_FUNDING_CELO = 100n * 10n ** 18n;

// ── pure calldata helpers (exported for scripts/fork-seed.test.mjs) ─────────

/** @param {string} value */
export const strip0x = (value) =>
  value.startsWith("0x") ? value.slice(2) : value;

/** @param {string} address */
export const padAddress = (address) =>
  strip0x(address).toLowerCase().padStart(64, "0");

/** @param {bigint | number | string} value */
export const padUint = (value) => BigInt(value).toString(16).padStart(64, "0");

/** @param {bigint} value */
export const toHexQuantity = (value) => "0x" + value.toString(16);

/**
 * @param {string} to
 * @param {bigint} amount
 */
export function encodeTransfer(to, amount) {
  return SEL.transfer + padAddress(to) + padUint(amount);
}

/** @param {string} owner */
export function encodeBalanceOf(owner) {
  return SEL.balanceOf + padAddress(owner);
}

/** @param {string} rateFeedId */
export function encodeMedianRate(rateFeedId) {
  return SEL.medianRate + padAddress(rateFeedId);
}

/** @param {string} rateFeedId */
export function encodeTokenReportExpirySeconds(rateFeedId) {
  return SEL.tokenReportExpirySeconds + padAddress(rateFeedId);
}

/**
 * report(rateFeedId, median, lesserKey=address(0), greaterKey=address(0)) —
 * see the "Why address(0)" note in #442 for why the zero hints are valid on
 * Mento mainnet feeds (each relayer is the feed's sole oracle).
 *
 * @param {string} rateFeedId
 * @param {bigint} median
 */
export function encodeReport(rateFeedId, median) {
  return (
    SEL.report +
    padAddress(rateFeedId) +
    padUint(median) +
    padUint(0) +
    padUint(0)
  );
}

/** @param {string} rateFeedId */
export function encodeGetOracles(rateFeedId) {
  return SEL.getOracles + padAddress(rateFeedId);
}

/** Decodes an address returned as a single 32-byte word (last 20 bytes). */
/** @param {string} word */
export function decodeAddressWord(word) {
  return "0x" + strip0x(word).slice(-40);
}

/**
 * Decodes an `address[]` return value (32-byte offset word, 32-byte length
 * word, then one 32-byte word per address).
 *
 * @param {string} data
 */
export function decodeAddressArray(data) {
  const body = strip0x(data);
  if (body.length < 128) return [];
  const count = Number(BigInt("0x" + body.slice(64, 128)));
  /** @type {string[]} */
  const addresses = [];
  for (let index = 0; index < count; index++) {
    const word = body.slice(128 + index * 64, 128 + (index + 1) * 64);
    if (word.length < 64) break;
    addresses.push("0x" + word.slice(-40));
  }
  return addresses;
}

// ── JSON-RPC ─────────────────────────────────────────────────────────────────

let requestId = 0;

/**
 * @param {string} method
 * @param {unknown[]} [params]
 */
async function rpc(method, params = []) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
  });
  const json = await response.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

/**
 * @param {string} to
 * @param {string} data
 */
const ethCall = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);

/**
 * @param {string} token
 * @param {string} owner
 */
async function balanceOf(token, owner) {
  return BigInt(await ethCall(token, encodeBalanceOf(owner)));
}

/**
 * @param {string} address
 * @param {string} weiHex
 */
const setBalance = (address, weiHex) =>
  rpc("anvil_setBalance", [address, weiHex]);

/** @param {string} address */
const impersonate = (address) => rpc("anvil_impersonateAccount", [address]);

/** @param {string} address */
const stopImpersonating = (address) =>
  rpc("anvil_stopImpersonatingAccount", [address]);

/**
 * Sends a tx from an impersonated/unlocked account and waits for anvil's
 * auto-mined receipt (anvil mines instantly, but the receipt is fetched via
 * a short poll to be safe).
 *
 * @param {string} from
 * @param {string} to
 * @param {string} data
 */
async function sendAndWait(from, to, data) {
  const hash = await rpc("eth_sendTransaction", [{ from, to, data }]);
  for (let attempt = 0; attempt < 50; attempt++) {
    const receipt = await rpc("eth_getTransactionReceipt", [hash]);
    if (receipt) {
      if (receipt.status !== "0x1") {
        throw new Error(`tx ${hash} reverted`);
      }
      return receipt;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`tx ${hash} was not mined within 5s`);
}

/**
 * Funds `address` with gas, impersonates it, runs `fn`, then always
 * de-impersonates — even though `--auto-impersonate` makes the explicit
 * impersonate/stop redundant, this keeps the script working if anvil is ever
 * started without that flag.
 *
 * @template T
 * @param {string} address
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withImpersonation(address, fn) {
  await setBalance(address, toHexQuantity(GAS_FUNDING_CELO));
  await impersonate(address);
  try {
    return await fn();
  } finally {
    await stopImpersonating(address);
  }
}

// ── console output ──────────────────────────────────────────────────────────

/** @param {string} message */
function ok(message) {
  console.log(`\x1b[32m✔\x1b[0m ${message}`);
}

/** @param {string} message */
function warn(message) {
  console.warn(`\x1b[33m⚠\x1b[0m ${message}`);
}

/** @param {string} message */
function fail(message) {
  console.error(`\x1b[31m✖\x1b[0m ${message}`);
}

// ── steps ────────────────────────────────────────────────────────────────────

async function assertMainnetFork() {
  /** @type {string} */
  let chainId;
  try {
    chainId = await rpc("eth_chainId");
  } catch (/** @type {unknown} */ error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`Could not reach ${RPC_URL} (${message}).`);
    fail("Start the fork first: pnpm fork:mainnet");
    process.exit(1);
  }
  if (chainId !== CELO_MAINNET_CHAIN_ID) {
    fail(
      `${RPC_URL} reports chain ${chainId}, not Celo mainnet (${CELO_MAINNET_CHAIN_ID}). ` +
        "fork-seed.mjs only targets a Celo mainnet fork — start it first: pnpm fork:mainnet",
    );
    process.exit(1);
  }
  ok(`Connected to Celo mainnet fork at ${RPC_URL}`);
}

/**
 * Advances the fork's clock to wall-clock time. A fork pinned to a past
 * block boots with chain time hours behind the real world, and anvil stamps
 * descendant blocks parent+1s — so `block.timestamp` stays in the past. The
 * mento-sdk validates swap deadlines against wall-clock `Date.now()`
 * (SwapService.prepareSwap), so every app swap on such a fork fails with
 * "Deadline must be in the future" (PR #456 run 29063449487). Syncing the
 * clock BEFORE the oracle re-reports below also means every re-reported
 * median carries a fresh wall-clock timestamp.
 */
async function syncClockToWallTime() {
  /** @type {{timestamp: string}} */
  const latest = await rpc("eth_getBlockByNumber", ["latest", false]);
  const chainNow = BigInt(latest.timestamp);
  const wallNow = BigInt(Math.floor(Date.now() / 1000));
  if (wallNow <= chainNow) {
    ok(
      `Fork clock (${chainNow}) is at/ahead of wall clock (${wallNow}) — no sync needed`,
    );
    return;
  }
  await rpc("evm_setNextBlockTimestamp", [toHexQuantity(wallNow)]);
  await rpc("evm_mine", []);
  ok(
    `Advanced fork clock by ${wallNow - chainNow}s to wall-clock time ${wallNow} ` +
      "(pinned-block forks boot in the past, which breaks SDK swap-deadline validation)",
  );
}

async function fundNativeCelo() {
  try {
    for (const account of ANVIL_ACCOUNTS) {
      await setBalance(account, toHexQuantity(TARGET_ACCOUNT_CELO));
    }
  } catch (/** @type {unknown} */ error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(
      `anvil_setBalance failed (${message}) — is ${RPC_URL} really anvil? Refusing to continue.`,
    );
    process.exit(1);
  }
  ok(
    `Funded ${ANVIL_ACCOUNTS.length} anvil accounts with 10,000 CELO each ` +
      `(native + ERC-20 duality via ${CELO} under --celo — no separate transfer needed)`,
  );
}

async function fundTokens() {
  for (const token of TOKENS) {
    const target = 1_000n * 10n ** BigInt(token.decimals);
    for (const recipient of ANVIL_ACCOUNTS) {
      const current = await balanceOf(token.address, recipient);
      if (current >= target) {
        console.log(`  ${token.symbol} -> ${recipient}: already funded`);
        continue;
      }

      const whaleBalance = await balanceOf(token.address, token.whale);
      if (whaleBalance < target) {
        warn(
          `${token.symbol} whale ${token.whale} holds ${whaleBalance}, below the ` +
            `${target} target for ${recipient} — skipping (mainnet whale balance may have drifted)`,
        );
        continue;
      }

      try {
        await withImpersonation(token.whale, () =>
          sendAndWait(
            token.whale,
            token.address,
            encodeTransfer(recipient, target),
          ),
        );
        ok(`${token.symbol} -> ${recipient}: funded to ${target}`);
      } catch (/** @type {unknown} */ error) {
        // Same skip-with-warning policy as a dry whale: a per-recipient
        // transfer failure (e.g. paused token, blocklisted whale) must not
        // abort the run — oracle re-reporting below still needs to happen.
        const message = error instanceof Error ? error.message : String(error);
        warn(
          `${token.symbol} -> ${recipient}: transfer from whale failed (${message}) — skipping`,
        );
      }
    }
  }
}

/** @param {string} relayer */
async function resolveRateFeedId(relayer) {
  return decodeAddressWord(await ethCall(relayer, SEL.rateFeedId));
}

/** @param {string} rateFeedId */
async function readReportExpirySeconds(rateFeedId) {
  const perToken = BigInt(
    await ethCall(SORTED_ORACLES, encodeTokenReportExpirySeconds(rateFeedId)),
  );
  if (perToken > 0n) return perToken;
  return BigInt(await ethCall(SORTED_ORACLES, SEL.reportExpirySeconds));
}

async function reportOracles() {
  /** @type {Array<{pair: string, relayer: string, rateFeedId: string | null, median: bigint | null, expiry: bigint | null, status: string}>} */
  const rows = [];
  for (const [pair, relayer] of Object.entries(RELAYERS)) {
    try {
      const rateFeedId = await resolveRateFeedId(relayer);
      const medianWord = await ethCall(
        SORTED_ORACLES,
        encodeMedianRate(rateFeedId),
      );
      // medianRate() returns two 32-byte words — the median, then the (unused)
      // fixidity denominator (1e24).
      const median = BigInt(medianWord.slice(0, 66));
      if (median === 0n) {
        rows.push({
          pair,
          relayer,
          rateFeedId,
          median,
          expiry: null,
          status: "skipped (no rate)",
        });
        continue;
      }

      await withImpersonation(relayer, () =>
        sendAndWait(relayer, SORTED_ORACLES, encodeReport(rateFeedId, median)),
      );
      const expiry = await readReportExpirySeconds(rateFeedId);
      rows.push({
        pair,
        relayer,
        rateFeedId,
        median,
        expiry,
        status: "reported",
      });
    } catch (/** @type {unknown} */ error) {
      const message = error instanceof Error ? error.message : String(error);
      warn(`${pair}: ${message}`);
      rows.push({
        pair,
        relayer,
        rateFeedId: null,
        median: null,
        expiry: null,
        status: `failed: ${message}`,
      });
    }
  }
  return rows;
}

/**
 * Re-reports the legacy-token rate feeds (LEGACY_RATE_FEEDS) whose oracles
 * are discovered via SortedOracles.getOracles(rateFeedId) rather than the
 * RELAYERS map. Reports the current median from every listed oracle with the
 * same zero lesser/greater hints as reportOracles() — valid while each feed
 * has a single oracle (verified on mainnet 2026-07-10, see #452); if a feed
 * grows multiple oracles again the extra reports revert and are skipped with
 * a warning, keeping the run alive.
 */
async function reportLegacyOracles() {
  /** @type {Array<{pair: string, relayer: string, rateFeedId: string | null, median: bigint | null, expiry: bigint | null, status: string}>} */
  const rows = [];
  for (const [pair, rateFeedId] of Object.entries(LEGACY_RATE_FEEDS)) {
    try {
      const oracles = decodeAddressArray(
        await ethCall(SORTED_ORACLES, encodeGetOracles(rateFeedId)),
      );
      if (oracles.length === 0) {
        rows.push({
          pair,
          relayer: "-",
          rateFeedId,
          median: null,
          expiry: null,
          status: "skipped (no oracles)",
        });
        continue;
      }
      const oracleLabel =
        oracles[0] + (oracles.length > 1 ? ` (+${oracles.length - 1})` : "");

      const medianWord = await ethCall(
        SORTED_ORACLES,
        encodeMedianRate(rateFeedId),
      );
      const median = BigInt(medianWord.slice(0, 66));
      if (median === 0n) {
        rows.push({
          pair,
          relayer: oracleLabel,
          rateFeedId,
          median,
          expiry: null,
          status: "skipped (no rate)",
        });
        continue;
      }

      let reportedCount = 0;
      for (const oracle of oracles) {
        try {
          await withImpersonation(oracle, () =>
            sendAndWait(
              oracle,
              SORTED_ORACLES,
              encodeReport(rateFeedId, median),
            ),
          );
          reportedCount++;
        } catch (/** @type {unknown} */ error) {
          const message =
            error instanceof Error ? error.message : String(error);
          warn(
            `${pair}: report from oracle ${oracle} failed (${message}) — skipping`,
          );
        }
      }
      const expiry = await readReportExpirySeconds(rateFeedId);
      rows.push({
        pair,
        relayer: oracleLabel,
        rateFeedId,
        median,
        expiry,
        status:
          reportedCount > 0
            ? "reported"
            : "failed: all oracle reports reverted",
      });
    } catch (/** @type {unknown} */ error) {
      const message = error instanceof Error ? error.message : String(error);
      warn(`${pair}: ${message}`);
      rows.push({
        pair,
        relayer: "-",
        rateFeedId,
        median: null,
        expiry: null,
        status: `failed: ${message}`,
      });
    }
  }
  return rows;
}

/**
 * @param {Array<{pair: string, relayer: string, rateFeedId: string | null, median: bigint | null, expiry: bigint | null, status: string}>} rows
 */
function printSummary(rows) {
  console.log("\nOracle re-report summary:");
  const header = [
    "pair",
    "relayer",
    "rateFeedId",
    "median",
    "expiry(s)",
    "status",
  ];
  const cells = rows.map((row) => [
    row.pair,
    row.relayer,
    row.rateFeedId ?? "-",
    row.median?.toString() ?? "-",
    row.expiry?.toString() ?? "-",
    row.status,
  ]);
  const widths = header.map((head, col) =>
    Math.max(head.length, ...cells.map((row) => row[col].length)),
  );
  /** @param {string[]} row */
  const printRow = (row) =>
    console.log(row.map((cell, col) => cell.padEnd(widths[col])).join("  "));
  printRow(header);
  printRow(widths.map((width) => "-".repeat(width)));
  cells.forEach(printRow);

  const reportedExpiries = rows
    .filter((row) => row.status === "reported" && row.expiry !== null)
    .map((row) => /** @type {bigint} */ (row.expiry));

  if (reportedExpiries.length > 0) {
    const minExpiry = reportedExpiries.reduce((min, value) =>
      value < min ? value : min,
    );
    console.log(
      `\nRe-run \`pnpm fork:seed\` after every evm_revert and within ${minExpiry}s when quotes start reverting (oracle staleness).`,
    );
  } else {
    console.log(
      "\nRe-run `pnpm fork:seed` after every evm_revert and whenever quotes start reverting (oracle staleness).",
    );
  }
}

async function main() {
  await assertMainnetFork();
  await syncClockToWallTime();
  await fundNativeCelo();
  await fundTokens();
  const oracleRows = await reportOracles();
  const legacyRows = await reportLegacyOracles();
  printSummary([...oracleRows, ...legacyRows]);
}

// Only run when executed directly (`node scripts/fork-seed.mjs` /
// `pnpm fork:seed`) — not when imported for its exported helpers, e.g. by
// scripts/fork-seed.test.mjs.
const isMainModule =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((/** @type {unknown} */ error) => {
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    fail(`Unexpected error: ${message}`);
    process.exit(1);
  });
}
