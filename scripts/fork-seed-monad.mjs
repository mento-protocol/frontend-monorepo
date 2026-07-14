#!/usr/bin/env node
/**
 * Seeds a local anvil fork of Monad mainnet (chain 143) for wallet-gated E2E
 * testing of app.mento.org (see #489, follow-up to the Celo-only #441/#442).
 *
 * Monad runs a different Mento stack than Celo — no Broker/BiPoolManager;
 * instead Router + FPMMFactory + SortedOracles — so this is a sibling of
 * scripts/fork-seed.mjs, NOT a generalization of it: the chain guard, the
 * seeding sources, and the oracle-feed discovery are all Monad-specific. It
 * keeps fork-seed.mjs's zero-dependency style and self-test pattern so the two
 * can be maintained side by side.
 *
 *   1. Re-reports every FPMM's SortedOracles median so Router quotes don't
 *      revert `NoRecentRate()` once the fork clock moves — feeds are discovered
 *      on-chain (`FPMMFactory.deployedFPMMAddresses()` ->
 *      `FPMM.referenceRateFeedID()`) and each feed's reporters via
 *      `SortedOracles.getOracles(rateFeedId)` (Monad has no relayer map). This
 *      runs first because the swap-based seeding below needs fresh oracles.
 *   2. Funds the anvil junk accounts (mnemonic `test test ... junk`) with the
 *      three collateral tokens (USDC, AUSD, USDT0) by impersonating the Reserve
 *      — a vault, not a pool, so transferring from it breaks nothing.
 *   3. Tops each junk account up to >= 1,000 units of every Mento stablecoin
 *      (USDm, EURm, GBPm, JPYm, CHFm) by executing REAL Router swaps
 *      (USDC -> USDm, then USDm -> X) through the live FPMM pools.
 *   4. Funds each junk account with 10,000 native MON via `anvil_setBalance`
 *      (gas only — MON is never a swap leg; app.mento.org on Monad is
 *      stablecoins-only).
 *
 * Why swaps instead of whale transfers (the Celo pattern): on Monad the only
 * large holder of each Mento-minted leg IS its own FPMM pool, and an FPMM
 * tracks reserve value — pulling tokens straight out of a pool by impersonation
 * drops its balance below its stored reserve, and every subsequent swap through
 * that pool then reverts `InsufficientInputAmount` / `ReserveValueDecreased`
 * (verified live 2026-07-14, even at 1,000 units — the reserve-accounting guard
 * fires, not a price breaker). No mint authority is reachable from the Reserve
 * or the liquidity strategies either. A legitimate swap, by contrast, preserves
 * the pool's reserve invariant, so it is the one seeding path that leaves every
 * pool tradeable. FPMM prices off the oracle (constant marginal rate, no
 * x*y=k slippage), so these seeding swaps do not move quotes.
 *
 * Idempotent: every acquisition is guarded by a balance check, so a re-run
 * skips already-funded tokens; oracle re-reporting is safe to repeat (same
 * median, fresh timestamp).
 *
 * Zero-dependency: plain Node >= 22 built-ins + native fetch, raw JSON-RPC to
 * the fork. No viem/ethers — calldata is hand-encoded (see the ENCODE helpers
 * below), mirroring scripts/fork-seed.mjs.
 *
 * Run: `pnpm fork:seed:monad` (requires `pnpm fork:monad` running first)
 */

import process from "node:process";
import { pathToFileURL } from "node:url";

// ── configuration ────────────────────────────────────────────────────────────

// Override target for pointing at a non-default anvil port/host; not a turbo
// pipeline input.
// eslint-disable-next-line turbo/no-undeclared-env-vars
const RPC_URL = process.env["FORK_RPC_URL"] ?? "http://127.0.0.1:8546";
const MONAD_MAINNET_CHAIN_ID = "0x8f"; // 143

// Anvil's well-known junk accounts (mnemonic `test test test test test test
// test test test test test junk`). Public by design — never real key
// material, never used on a real network.
const ANVIL_ACCOUNTS = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", // acct0
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", // acct1
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", // acct2
];

// Monad mainnet (143) Mento contracts — from the SDK's `addresses[143]` map
// (@mento-protocol/mento-sdk@3.3.0-beta.1); hardcoded here to keep the seed
// script zero-dependency, exactly as fork-seed.mjs hardcodes Celo's. Pools and
// rate feeds are discovered on-chain (not hardcoded) via the factory.
const ROUTER = "0x4861840C2EfB2b98312B0aE34d86fD73E8f9B6f6";
const FPMM_FACTORY = "0xa849b475FE5a4B5C9C3280152c7a1945b907613b";
const SORTED_ORACLES = "0x6f92C745346057a61b259579256159458a0a6A92";
const RESERVE = "0x4255Cf38e51516766180b33122029A88Cb853806";

// Token addresses + decimals from the SDK's `TOKEN_ADDRESSES_BY_CHAIN[143]`.
const USDC = {
  symbol: "USDC",
  address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
  decimals: 6,
};
const AUSD = {
  symbol: "AUSD",
  address: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a",
  decimals: 6,
};
const USDT0 = {
  symbol: "USDT0",
  address: "0xe7cd86e13AC4309349F30B3435a9d337750fC82D",
  decimals: 6,
};
const USDM = {
  symbol: "USDm",
  address: "0xBC69212B8E4d445b2307C9D32dD68E2A4Df00115",
  decimals: 18,
};

// Collateral tokens (USDC, AUSD, USDT0) are held by the Reserve (a vault, not a
// pool), so a plain impersonated transfer out is safe and moves no pool's
// reserves — they are seeded directly in seedAccount().

// Mento stablecoins seeded via swaps. USDm is the hub: acquired from USDC
// (USDC -> USDm), then swapped into every other leg (USDm -> X). Each pool is
// USDm-paired, so all swaps are single-hop.
const SWAP_STABLES = [
  {
    symbol: "EURm",
    address: "0x4D502d735B4C574B487Ed641ae87cEaE884731C7",
    decimals: 18,
  },
  {
    symbol: "GBPm",
    address: "0x39bb4E0a204412bB98e821d25e7d955e69d40Fd1",
    decimals: 18,
  },
  {
    symbol: "JPYm",
    address: "0x22f6A6752800eAB67b84748FeFc3cC658384aF72",
    decimals: 18,
  },
  {
    symbol: "CHFm",
    address: "0xF64e91fFEf7ef43aA314F0Bc2AC39f770797990C",
    decimals: 18,
  },
];

// Function selectors (keccak-256 of the canonical signature, first 4 bytes).
const SEL = {
  transfer: "0xa9059cbb", // transfer(address,uint256)
  approve: "0x095ea7b3", // approve(address,uint256)
  balanceOf: "0x70a08231", // balanceOf(address)
  report: "0x80e50744", // report(address,uint256,address,address)
  medianRate: "0xef90e1b0", // medianRate(address)
  tokenReportExpirySeconds: "0x2e86bc01", // tokenReportExpirySeconds(address)
  reportExpirySeconds: "0x493a353c", // reportExpirySeconds()
  getOracles: "0x8e749281", // getOracles(address)
  deployedFPMMAddresses: "0x162cb913", // deployedFPMMAddresses()
  referenceRateFeedID: "0xfb1a6375", // referenceRateFeedID()
  getAmountsOut: "0x66e56f6d", // getAmountsOut(uint256,(address,address,address)[]) — Route[] tuple, not Uniswap's address[]
  swapExactTokensForTokens: "0x3375aa2a", // swapExactTokensForTokens(uint256,uint256,(address,address,address)[],address,uint256) — Route[] tuple
};

const TARGET_ACCOUNT_MON = 10_000n * 10n ** 18n;
const GAS_FUNDING_MON = 100n * 10n ** 18n;

// FPMM charges a small swap fee and quotes round down, so a swap sized off the
// spot rate can land just under target — buy 5% extra input; a re-run tops up
// any residual shortfall.
const SEED_INPUT_BUFFER_NUMERATOR = 105n;
const SEED_INPUT_BUFFER_DENOMINATOR = 100n;

// ── pure calldata helpers (exported for scripts/fork-seed-monad.test.mjs) ────

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

/**
 * @param {string} spender
 * @param {bigint} amount
 */
export function encodeApprove(spender, amount) {
  return SEL.approve + padAddress(spender) + padUint(amount);
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
 * the zero hints are valid while each Monad feed has a single oracle (the
 * EURm/USDm feed has exactly one reporter, numRates=1; see #489 Phase-0). If a
 * feed grows multiple oracles the extra reports revert and are skipped.
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

/**
 * getAmountsOut(amountIn, [Route{from,to,factory}]) for a single-hop route.
 * The Router's Route is a static tuple of three addresses, so the dynamic
 * array is: offset(0x40), length(1), then the three address words.
 *
 * @param {bigint} amountIn
 * @param {string} from
 * @param {string} to
 * @param {string} factory
 */
export function encodeGetAmountsOut(amountIn, from, to, factory) {
  return (
    SEL.getAmountsOut +
    padUint(amountIn) +
    padUint(0x40) +
    padUint(1) +
    padAddress(from) +
    padAddress(to) +
    padAddress(factory)
  );
}

/**
 * swapExactTokensForTokens(amountIn, amountOutMin, [Route{from,to,factory}],
 * to, deadline) for a single-hop route. Five head words precede the routes
 * array, so its offset is 0xa0.
 *
 * @param {bigint} amountIn
 * @param {bigint} amountOutMin
 * @param {string} from
 * @param {string} to
 * @param {string} factory
 * @param {string} recipient
 * @param {bigint} deadline
 */
export function encodeSwapExactTokensForTokens(
  amountIn,
  amountOutMin,
  from,
  to,
  factory,
  recipient,
  deadline,
) {
  return (
    SEL.swapExactTokensForTokens +
    padUint(amountIn) +
    padUint(amountOutMin) +
    padUint(0xa0) +
    padAddress(recipient) +
    padUint(deadline) +
    padUint(1) +
    padAddress(from) +
    padAddress(to) +
    padAddress(factory)
  );
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

/**
 * Decodes a `uint256[]` return value (32-byte offset word, 32-byte length
 * word, then one 32-byte word per element).
 *
 * @param {string} data
 */
export function decodeUintArray(data) {
  const body = strip0x(data);
  if (body.length < 128) return [];
  const count = Number(BigInt("0x" + body.slice(64, 128)));
  /** @type {bigint[]} */
  const values = [];
  for (let index = 0; index < count; index++) {
    const word = body.slice(128 + index * 64, 128 + (index + 1) * 64);
    if (word.length < 64) break;
    values.push(BigInt("0x" + word));
  }
  return values;
}

// ── JSON-RPC ─────────────────────────────────────────────────────────────────

let requestId = 0;

// Armed by assertMonadFork() once anvil has answered. Before that, a
// connection failure falls through to the preflight's friendlier "start the
// fork first" handling; after it, losing the connection mid-seed means anvil
// crashed, and every remaining step would fail the same way — so abort
// immediately instead of drowning the real error in per-item warnings.
let anvilConfirmedReachable = false;

/**
 * @param {string} method
 * @param {unknown[]} [params]
 */
async function rpc(method, params = []) {
  /** @type {Response} */
  let response;
  try {
    response = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
    });
  } catch (/** @type {unknown} */ error) {
    if (anvilConfirmedReachable) {
      const message = error instanceof Error ? error.message : String(error);
      fail(
        `Lost connection to anvil at ${RPC_URL} mid-seed (${method}: ${message}).`,
      );
      fail("The fork process has likely crashed — check its log for a panic.");
      process.exit(1);
    }
    throw error;
  }
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
 * auto-mined receipt (anvil mines instantly, but the receipt is fetched via a
 * short poll to be safe).
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
  await setBalance(address, toHexQuantity(GAS_FUNDING_MON));
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

async function assertMonadFork() {
  /** @type {string} */
  let chainId;
  try {
    chainId = await rpc("eth_chainId");
  } catch (/** @type {unknown} */ error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`Could not reach ${RPC_URL} (${message}).`);
    fail("Start the fork first: pnpm fork:monad");
    process.exit(1);
  }
  if (chainId !== MONAD_MAINNET_CHAIN_ID) {
    fail(
      `${RPC_URL} reports chain ${chainId}, not Monad mainnet (${MONAD_MAINNET_CHAIN_ID}). ` +
        "fork-seed-monad.mjs only targets a Monad mainnet fork — start it first: pnpm fork:monad",
    );
    process.exit(1);
  }
  ok(`Connected to Monad mainnet fork at ${RPC_URL}`);
  anvilConfirmedReachable = true;
}

/**
 * Advances the fork's clock to wall-clock time. A fork pinned to a past block
 * boots with chain time behind the real world, and anvil stamps descendant
 * blocks parent+1s — so `block.timestamp` stays in the past. The mento-sdk
 * validates swap deadlines against wall-clock `Date.now()`, so every app swap
 * on such a fork fails "Deadline must be in the future". Syncing the clock
 * BEFORE the oracle re-reports below also means every re-reported median
 * carries a fresh wall-clock timestamp.
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

/**
 * Discovers every FPMM pool's rate feed on-chain: the factory lists all pools,
 * each pool exposes its `referenceRateFeedID()`. De-duplicated because a feed
 * can back more than one pool.
 *
 * @returns {Promise<Array<{pool: string, rateFeedId: string}>>}
 */
async function discoverRateFeeds() {
  const pools = decodeAddressArray(
    await ethCall(FPMM_FACTORY, SEL.deployedFPMMAddresses),
  );
  /** @type {Array<{pool: string, rateFeedId: string}>} */
  const feeds = [];
  const seen = new Set();
  for (const pool of pools) {
    try {
      const rateFeedId = decodeAddressWord(
        await ethCall(pool, SEL.referenceRateFeedID),
      );
      if (seen.has(rateFeedId.toLowerCase())) continue;
      seen.add(rateFeedId.toLowerCase());
      feeds.push({ pool, rateFeedId });
    } catch (/** @type {unknown} */ error) {
      const message = error instanceof Error ? error.message : String(error);
      warn(
        `pool ${pool}: referenceRateFeedID() failed (${message}) — skipping`,
      );
    }
  }
  return feeds;
}

/** @param {string} rateFeedId */
async function readReportExpirySeconds(rateFeedId) {
  const perToken = BigInt(
    await ethCall(SORTED_ORACLES, encodeTokenReportExpirySeconds(rateFeedId)),
  );
  if (perToken > 0n) return perToken;
  return BigInt(await ethCall(SORTED_ORACLES, SEL.reportExpirySeconds));
}

/**
 * Re-reports every discovered FPMM rate feed. Oracles are discovered via
 * SortedOracles.getOracles(rateFeedId) — Monad has no relayer map, so this is
 * the only reporting path (mirrors fork-seed.mjs's reportLegacyOracles). Each
 * listed oracle re-reports the current median with zero lesser/greater hints;
 * if a feed has multiple oracles the extra reports may revert and are skipped
 * with a warning, keeping the run alive.
 *
 * @param {Array<{pool: string, rateFeedId: string}>} feeds
 */
async function reportOracles(feeds) {
  /** @type {Array<{pool: string, oracle: string, rateFeedId: string, median: bigint | null, expiry: bigint | null, status: string}>} */
  const rows = [];
  for (const { pool, rateFeedId } of feeds) {
    try {
      const oracles = decodeAddressArray(
        await ethCall(SORTED_ORACLES, encodeGetOracles(rateFeedId)),
      );
      if (oracles.length === 0) {
        rows.push({
          pool,
          oracle: "-",
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
      // medianRate() returns two 32-byte words — the median, then the (unused)
      // fixidity denominator.
      const median = BigInt(medianWord.slice(0, 66));
      if (median === 0n) {
        rows.push({
          pool,
          oracle: oracleLabel,
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
            `${rateFeedId}: report from oracle ${oracle} failed (${message}) — skipping`,
          );
        }
      }
      const expiry = await readReportExpirySeconds(rateFeedId);
      rows.push({
        pool,
        oracle: oracleLabel,
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
      warn(`${rateFeedId}: ${message}`);
      rows.push({
        pool,
        oracle: "-",
        rateFeedId,
        median: null,
        expiry: null,
        status: `failed: ${message}`,
      });
    }
  }
  return rows;
}

// ── swap-based seeding ────────────────────────────────────────────────────────

/** target balance = 1,000 units of a token */
const target = (/** @type {{decimals: number}} */ token) =>
  1_000n * 10n ** BigInt(token.decimals);

/**
 * Last element of Router.getAmountsOut for a single-hop route (the amount of
 * `tokenOut` a swap of `amountIn` `tokenIn` yields).
 *
 * @param {string} tokenIn
 * @param {string} tokenOut
 * @param {bigint} amountIn
 */
async function quoteOut(tokenIn, tokenOut, amountIn) {
  const amounts = decodeUintArray(
    await ethCall(
      ROUTER,
      encodeGetAmountsOut(amountIn, tokenIn, tokenOut, FPMM_FACTORY),
    ),
  );
  return amounts.length > 0 ? amounts[amounts.length - 1] : 0n;
}

/**
 * Input amount of `tokenIn` needed to receive at least `targetOut` of
 * `tokenOut`. FPMM pricing is linear (constant oracle rate), so a spot probe
 * scales exactly; a buffer covers the swap fee + rounding.
 *
 * @param {{address: string, decimals: number}} tokenIn
 * @param {string} tokenOut
 * @param {bigint} targetOut
 */
async function inputForTarget(tokenIn, tokenOut, targetOut) {
  const probe = 10n ** BigInt(tokenIn.decimals);
  const out = await quoteOut(tokenIn.address, tokenOut, probe);
  if (out === 0n) {
    throw new Error(`no quote for ${tokenIn.address} -> ${tokenOut}`);
  }
  const raw = (targetOut * probe) / out;
  return (
    (raw * SEED_INPUT_BUFFER_NUMERATOR) / SEED_INPUT_BUFFER_DENOMINATOR + 1n
  );
}

/**
 * Transfers `amount` of a collateral token from the Reserve to `recipient`.
 *
 * @param {{symbol: string, address: string}} token
 * @param {string} recipient
 * @param {bigint} amount
 */
async function transferFromReserve(token, recipient, amount) {
  const reserveBalance = await balanceOf(token.address, RESERVE);
  if (reserveBalance < amount) {
    throw new Error(
      `Reserve holds ${reserveBalance} ${token.symbol}, below the ${amount} needed`,
    );
  }
  await withImpersonation(RESERVE, () =>
    sendAndWait(RESERVE, token.address, encodeTransfer(recipient, amount)),
  );
}

/**
 * Executes a real single-hop Router swap from `recipient` (approve + swap),
 * accepting any output (amountOutMin = 0 — this is seeding, not a user trade).
 *
 * @param {string} recipient
 * @param {string} tokenIn
 * @param {string} tokenOut
 * @param {bigint} amountIn
 */
async function swapFrom(recipient, tokenIn, tokenOut, amountIn) {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  await withImpersonation(recipient, async () => {
    await sendAndWait(recipient, tokenIn, encodeApprove(ROUTER, amountIn));
    await sendAndWait(
      recipient,
      ROUTER,
      encodeSwapExactTokensForTokens(
        amountIn,
        0n,
        tokenIn,
        tokenOut,
        FPMM_FACTORY,
        recipient,
        deadline,
      ),
    );
  });
}

/**
 * Seeds one junk account to >= 1,000 units of every collateral and stable
 * token. Collateral comes straight from the Reserve; stables are bought with
 * real swaps (USDC -> USDm -> X). Every step is balance-guarded, so re-running
 * is a no-op once funded.
 *
 * @param {string} recipient
 */
async function seedAccount(recipient) {
  // 1. Collateral from the Reserve (AUSD/USDT0 to target; USDC handled with the
  //    swap on-ramp below, then topped up in step 4).
  for (const token of [AUSD, USDT0]) {
    if ((await balanceOf(token.address, recipient)) >= target(token)) {
      console.log(`  ${token.symbol} -> ${recipient}: already funded`);
      continue;
    }
    await transferFromReserve(token, recipient, target(token));
    ok(`${token.symbol} -> ${recipient}: funded from Reserve`);
  }

  // 2. Size the USDm -> X swaps and the total USDm needed.
  let usdmNeeded = 0n;
  /** @type {Array<{token: {symbol: string, address: string, decimals: number}, amountIn: bigint}>} */
  const stableSwaps = [];
  for (const token of SWAP_STABLES) {
    if ((await balanceOf(token.address, recipient)) >= target(token)) {
      console.log(`  ${token.symbol} -> ${recipient}: already funded`);
      continue;
    }
    const amountIn = await inputForTarget(USDM, token.address, target(token));
    stableSwaps.push({ token, amountIn });
    usdmNeeded += amountIn;
  }
  const totalUsdm = usdmNeeded + target(USDM); // + 1,000 USDm kept as USDm

  // 3. Acquire USDm (USDC -> USDm), pulling USDC from the Reserve as the
  //    on-ramp working capital.
  const usdmBalance = await balanceOf(USDM.address, recipient);
  if (usdmBalance < totalUsdm) {
    const usdcNeeded = await inputForTarget(
      USDC,
      USDM.address,
      totalUsdm - usdmBalance,
    );
    const usdcBalance = await balanceOf(USDC.address, recipient);
    if (usdcBalance < usdcNeeded) {
      await transferFromReserve(USDC, recipient, usdcNeeded - usdcBalance);
    }
    await swapFrom(recipient, USDC.address, USDM.address, usdcNeeded);
    ok(`USDm -> ${recipient}: bought via USDC->USDm swap`);
  } else {
    console.log(`  USDm -> ${recipient}: already funded`);
  }

  // 4. Swap USDm -> each remaining stable.
  for (const { token, amountIn } of stableSwaps) {
    await swapFrom(recipient, USDM.address, token.address, amountIn);
    ok(
      `${token.symbol} -> ${recipient}: bought via USDm->${token.symbol} swap`,
    );
  }

  // 5. Restore USDC to target (the on-ramp swap in step 3 spends it).
  const usdcBalance = await balanceOf(USDC.address, recipient);
  if (usdcBalance < target(USDC)) {
    await transferFromReserve(USDC, recipient, target(USDC) - usdcBalance);
    ok(`USDC -> ${recipient}: topped up from Reserve`);
  } else {
    console.log(`  USDC -> ${recipient}: already funded`);
  }
}

async function seedTokens() {
  for (const recipient of ANVIL_ACCOUNTS) {
    await seedAccount(recipient);
  }
}

async function fundNativeMon() {
  try {
    for (const account of ANVIL_ACCOUNTS) {
      await setBalance(account, toHexQuantity(TARGET_ACCOUNT_MON));
    }
  } catch (/** @type {unknown} */ error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(
      `anvil_setBalance failed (${message}) — is ${RPC_URL} really anvil? Refusing to continue.`,
    );
    process.exit(1);
  }
  ok(
    `Funded ${ANVIL_ACCOUNTS.length} anvil accounts with 10,000 MON each ` +
      "(gas only — MON is never a swap leg on Monad)",
  );
}

/**
 * @param {Array<{pool: string, oracle: string, rateFeedId: string, median: bigint | null, expiry: bigint | null, status: string}>} rows
 */
function printSummary(rows) {
  console.log("\nOracle re-report summary:");
  const header = [
    "pool",
    "oracle",
    "rateFeedId",
    "median",
    "expiry(s)",
    "status",
  ];
  const cells = rows.map((row) => [
    row.pool,
    row.oracle,
    row.rateFeedId,
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
      `\nRe-run \`pnpm fork:seed:monad\` after every evm_revert and within ${minExpiry}s when quotes start reverting (oracle staleness).`,
    );
  } else {
    console.log(
      "\nRe-run `pnpm fork:seed:monad` after every evm_revert and whenever quotes start reverting (oracle staleness).",
    );
  }
}

async function main() {
  await assertMonadFork();
  await syncClockToWallTime();
  const feeds = await discoverRateFeeds();
  const rows = await reportOracles(feeds);
  await seedTokens();
  await fundNativeMon();
  printSummary(rows);
}

// Only run when executed directly (`node scripts/fork-seed-monad.mjs` /
// `pnpm fork:seed:monad`) — not when imported for its exported helpers, e.g. by
// scripts/fork-seed-monad.test.mjs.
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
