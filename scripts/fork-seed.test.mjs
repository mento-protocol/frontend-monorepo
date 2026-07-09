#!/usr/bin/env node
/**
 * Tests for the pure calldata-encoding helpers exported by
 * scripts/fork-seed.mjs (transfer/balanceOf/report calldata, address/uint
 * padding, rateFeedId word decoding).
 *
 * Deliberately does NOT start anvil or make any network calls — fork-seed.mjs
 * only performs RPC/network side effects when run as the main module (see the
 * `isMainModule` guard at the bottom of that file), so importing it here for
 * its exports is safe.
 *
 * Run: node scripts/fork-seed.test.mjs
 */

import process from "node:process";
import {
  strip0x,
  padAddress,
  padUint,
  toHexQuantity,
  encodeTransfer,
  encodeBalanceOf,
  encodeMedianRate,
  encodeTokenReportExpirySeconds,
  encodeReport,
  decodeAddressWord,
} from "./fork-seed.mjs";

// ── helpers ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

/**
 * @param {string} name
 * @param {() => void} fn
 */
function test(name, fn) {
  try {
    fn();
    console.log(`  \x1b[32m✔\x1b[0m ${name}`);
    passed++;
  } catch (/** @type {unknown} */ err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  \x1b[31m✖\x1b[0m ${name}`);
    console.error(`    ${msg}`);
    failed++;
  }
}

/**
 * @param {boolean} condition
 * @param {string} msg
 */
function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

/**
 * @param {unknown} actual
 * @param {unknown} expected
 * @param {string} msg
 */
function assertEqual(actual, expected, msg) {
  assert(actual === expected, `${msg}: expected ${expected}, got ${actual}`);
}

// A known anvil junk account (acct0), used as a fixed fixture across tests.
const ACCT0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

// ── strip0x / padAddress / padUint / toHexQuantity ──────────────────────────

test("strip0x removes a leading 0x prefix", () => {
  assertEqual(strip0x("0xabcd"), "abcd", "strip0x with prefix");
});

test("strip0x is a no-op without a 0x prefix", () => {
  assertEqual(strip0x("abcd"), "abcd", "strip0x without prefix");
});

test("padAddress lowercases and left-pads to a 32-byte word", () => {
  assertEqual(
    padAddress(ACCT0),
    "000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266".slice(
      0,
      64,
    ),
    "padAddress output",
  );
  assertEqual(padAddress(ACCT0).length, 64, "padAddress length");
});

test("padUint hex-encodes and left-pads a uint256 word", () => {
  assertEqual(padUint(0), "0".repeat(64), "padUint(0)");
  assertEqual(
    padUint(1_000n * 10n ** 18n),
    "00000000000000000000000000000000000000000000003635c9adc5dea00000",
    "padUint(1000e18)",
  );
  assertEqual(padUint(1_000n * 10n ** 18n).length, 64, "padUint length");
});

test("toHexQuantity encodes a bigint as a 0x-prefixed hex quantity", () => {
  assertEqual(toHexQuantity(10_000n * 10n ** 18n), "0x21e19e0c9bab2400000");
});

// ── calldata encoders ────────────────────────────────────────────────────────

test("encodeTransfer matches transfer(address,uint256) calldata for a known input", () => {
  const calldata = encodeTransfer(ACCT0, 1_000n * 10n ** 18n);
  assertEqual(
    calldata,
    "0xa9059cbb000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb9226600000000000000000000000000000000000000000000003635c9adc5dea00000",
    "transfer calldata",
  );
  assertEqual(calldata.slice(0, 10), "0xa9059cbb", "transfer selector");
  assertEqual(calldata.length, 10 + 64 + 64, "transfer calldata length");
});

test("encodeBalanceOf matches balanceOf(address) calldata", () => {
  const calldata = encodeBalanceOf(ACCT0);
  assertEqual(
    calldata,
    "0x70a08231000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    "balanceOf calldata",
  );
});

test("encodeMedianRate matches medianRate(address) calldata", () => {
  const calldata = encodeMedianRate(ACCT0);
  assertEqual(calldata.slice(0, 10), "0xef90e1b0", "medianRate selector");
  assertEqual(calldata.length, 10 + 64, "medianRate calldata length");
});

test("encodeTokenReportExpirySeconds matches tokenReportExpirySeconds(address) calldata", () => {
  const calldata = encodeTokenReportExpirySeconds(ACCT0);
  assertEqual(
    calldata.slice(0, 10),
    "0x2e86bc01",
    "tokenReportExpirySeconds selector",
  );
});

test("encodeReport matches report(address,uint256,address,address) with zero hints", () => {
  const median = 500_000_000_000_000_000_000_000n; // a plausible fixidity-scaled median
  const calldata = encodeReport(ACCT0, median);
  assertEqual(calldata.slice(0, 10), "0x80e50744", "report selector");
  assertEqual(calldata.length, 10 + 64 * 4, "report calldata length");
  assertEqual(
    calldata,
    "0x80e50744" +
      padAddress(ACCT0) +
      padUint(median) +
      padUint(0) +
      padUint(0),
    "report calldata composition",
  );
});

// ── word decoding ────────────────────────────────────────────────────────────

test("decodeAddressWord extracts the trailing 20 bytes of a 32-byte word", () => {
  const word = "0x" + padAddress(ACCT0);
  assertEqual(decodeAddressWord(word), ACCT0.toLowerCase(), "decoded address");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
