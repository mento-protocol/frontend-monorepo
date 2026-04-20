#!/usr/bin/env node
/**
 * deal <token-address> <recipient-address> <amount-in-wei>
 *
 * Sets an ERC-20 balance by locating the storage slot via debug_traceCall
 * (prestateTracer) and writing directly with anvil_setStorageAt.
 *
 * Falls back to probing keccak256(address, N) for N in 0..19 when the
 * current balance is zero (nothing to match against in the trace).
 *
 * Requires a running Anvil node (default: http://localhost:8545).
 * Override with RPC_URL env var.
 */

import {
  createPublicClient,
  http,
  encodeFunctionData,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  toHex,
  pad,
  isAddress,
  zeroAddress,
} from "viem";

// -- args ----------------------------------------------------------------------

const [tokenAddress, recipientAddress, rawAmount] = process.argv.slice(2);

if (!tokenAddress || !recipientAddress || !rawAmount) {
  console.error(
    "Usage: deal <token-address> <recipient-address> <amount-in-wei>",
  );
  process.exit(1);
}

if (!isAddress(tokenAddress) || !isAddress(recipientAddress)) {
  console.error(
    "Both token-address and recipient-address must be valid EVM addresses.",
  );
  process.exit(1);
}

const amount = BigInt(rawAmount);
const RPC_URL = process.env.RPC_URL ?? "http://localhost:8545";

// -- native balance case -------------------------------------------------------
if (tokenAddress === zeroAddress) {
  const payload = {
    method: "anvil_setBalance",
    params: [recipientAddress, `0x${amount.toString(16)}`],
  };
  console.log(payload);
  await fetch(RPC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      ...payload,
    }),
  });
  process.exit(0);
}

// -- client --------------------------------------------------------------------

const client = createPublicClient({ transport: http(RPC_URL) });

const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
];

// -- helpers -------------------------------------------------------------------

async function getBalance() {
  return client.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [recipientAddress],
  });
}

function toStorageValue(value) {
  return pad(toHex(value), { size: 32 });
}

async function setStorageAt(slot, value) {
  await client.request({
    method: "anvil_setStorageAt",
    params: [tokenAddress, slot, toStorageValue(value)],
  });
}

async function snapshot() {
  return client.request({ method: "evm_snapshot", params: [] });
}

async function revert(snapId) {
  await client.request({ method: "evm_revert", params: [snapId] });
}

// -- slot discovery ------------------------------------------------------------

async function findSlotViaTrace(currentBalance) {
  const callData = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [recipientAddress],
  });

  const trace = await client.request({
    method: "debug_traceCall",
    params: [
      { to: tokenAddress, data: callData },
      "latest",
      { tracer: "prestateTracer" },
    ],
  });

  const tokenKey = tokenAddress.toLowerCase();
  const storage = trace[tokenKey]?.storage ?? {};
  const needle = toStorageValue(currentBalance).toLowerCase();

  for (const [slot, value] of Object.entries(storage)) {
    const normalized = pad(value.startsWith("0x") ? value : `0x${value}`, {
      size: 32,
    }).toLowerCase();

    if (normalized === needle) {
      return slot.startsWith("0x") ? slot : `0x${slot}`;
    }
  }

  return null;
}

async function findSlotViaBruteForce() {
  console.log("Balance is zero — probing mapping slots 0..19…");

  for (let i = 0; i < 20; i++) {
    const slot = keccak256(
      encodeAbiParameters(parseAbiParameters("address, uint256"), [
        recipientAddress,
        BigInt(i),
      ]),
    );

    const snapId = await snapshot();
    await setStorageAt(slot, amount);
    const found = (await getBalance()) === amount;
    await revert(snapId);

    if (found) {
      console.log(`Found at mapping slot index ${i}`);
      return slot;
    }
  }

  return null;
}

// -- main ----------------------------------------------------------------------

const currentBalance = await getBalance();
console.log(`Current balance : ${currentBalance}`);

let slot =
  currentBalance > 0n
    ? await findSlotViaTrace(currentBalance)
    : await findSlotViaBruteForce();

if (!slot) {
  console.error(
    "Could not locate the balance storage slot. " +
      "The token may use a non-standard storage layout.",
  );
  process.exit(1);
}

console.log(`Storage slot    : ${slot}`);

await setStorageAt(slot, amount);

const newBalance = await getBalance();
console.log(`New balance     : ${newBalance}`);

if (newBalance !== amount) {
  console.error(`Mismatch — expected ${amount}, got ${newBalance}`);
  process.exit(1);
}
