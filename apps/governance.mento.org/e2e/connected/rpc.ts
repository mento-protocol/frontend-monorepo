// Copied from apps/app.mento.org/e2e/connected/rpc.ts (#446) rather than
// extracted into a shared package — see the rationale in issue #448: this is
// ~50 lines of zero-dep code, and a new workspace package for it adds more
// surface than it saves.
const RPC_URL = "http://127.0.0.1:8545";

export async function rpc<T>(
  method: string,
  params: unknown[] = [],
): Promise<T> {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await response.json()) as {
    result?: T;
    error?: { message: string };
  };
  if (json.error) throw new Error(`${method} failed: ${json.error.message}`);
  return json.result as T;
}

export const snapshot = () => rpc<string>("evm_snapshot");
export const revert = (id: string) => rpc<boolean>("evm_revert", [id]);

export async function erc20BalanceOf(
  token: string,
  holder: string,
): Promise<bigint> {
  const data = `0x70a08231${holder.slice(2).toLowerCase().padStart(64, "0")}`;
  return BigInt(await rpc<string>("eth_call", [{ to: token, data }, "latest"]));
}

// NOT present in app.mento.org's copy — governance's write hooks wait for
// MULTIPLE confirmations (use-approve.ts: 2, use-lock-mento.ts: 10), and
// anvil's default automine only mines a block when a transaction arrives, so
// the spec must mine empty blocks in the background while a tx is pending.
export async function mineBlocks(count: number): Promise<void> {
  for (let i = 0; i < count; i++) await rpc("evm_mine", []);
}

// ── governance-lifecycle helpers (proposal-lifecycle.spec.ts, #502) ──────────
// Governance-local by design, same as mineBlocks above (per #448 this
// duplicated file grows per-app rather than being extracted). A proposal
// lifecycle needs out-of-band fork manipulation the lock specs never did:
// impersonated sends (fund/lock/updateDelay), batch mining to close a
// block-number voting period, timelock time-travel, and a storage poke to
// shrink the 691,200-block voting period (see the spec header for why storage,
// not anvil_mine, is the chosen fast-forward path).

const hexQuantity = (value: number | bigint): string =>
  `0x${BigInt(value).toString(16)}`;
const hexWord = (value: bigint): string =>
  `0x${value.toString(16).padStart(64, "0")}`;

export async function ethCall(to: string, data: string): Promise<string> {
  return rpc<string>("eth_call", [{ to, data }, "latest"]);
}

// Sends a transaction from `from` (anvil runs with --auto-impersonate, so no
// explicit unlock is needed) and waits for its auto-mined receipt, throwing on
// revert. Funds the sender with gas first — mirrors fork-seed.mjs's
// withImpersonation/sendAndWait, so impersonated whales like the Timelock (which
// hold tokens but little/no native CELO) can pay for gas.
export async function sendAs(
  from: string,
  to: string,
  data: string,
): Promise<{ transactionHash: string; blockNumber: bigint }> {
  await rpc("anvil_setBalance", [
    from,
    `0x${(100n * 10n ** 18n).toString(16)}`,
  ]);
  const hash = await rpc<string>("eth_sendTransaction", [{ from, to, data }]);
  for (let attempt = 0; attempt < 100; attempt++) {
    const receipt = await rpc<{
      status: string;
      blockNumber: string;
    } | null>("eth_getTransactionReceipt", [hash]);
    if (receipt) {
      if (receipt.status !== "0x1") throw new Error(`tx ${hash} reverted`);
      return {
        transactionHash: hash,
        blockNumber: BigInt(receipt.blockNumber),
      };
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`tx ${hash} was not mined within 10s`);
}

// Mines `count` blocks in ONE anvil_mine RPC call (interval seconds between
// each block's timestamp; 0 keeps timestamps within one wall-second). Used to
// close the (storage-shrunk) voting period cheaply.
export async function anvilMine(count: number, interval = 0): Promise<void> {
  await rpc("anvil_mine", [hexQuantity(count), hexQuantity(interval)]);
}

// Advances the fork clock by `seconds` and mines a block so the new timestamp
// is realized — used to pass the TimelockController eta before execute.
export async function increaseTime(seconds: number): Promise<void> {
  await rpc("evm_increaseTime", [hexQuantity(seconds)]);
  await rpc("evm_mine", []);
}

export async function getStorageAt(
  address: string,
  slot: number,
): Promise<bigint> {
  return BigInt(
    await rpc<string>("eth_getStorageAt", [
      address,
      hexQuantity(slot),
      "latest",
    ]),
  );
}

export async function setStorageAt(
  address: string,
  slot: number,
  value: bigint,
): Promise<void> {
  await rpc("anvil_setStorageAt", [
    address,
    hexWord(BigInt(slot)),
    hexWord(value),
  ]);
}

export async function latestTimestamp(): Promise<bigint> {
  const block = await rpc<{ timestamp: string }>("eth_getBlockByNumber", [
    "latest",
    false,
  ]);
  return BigInt(block.timestamp);
}

export async function blockNumber(): Promise<bigint> {
  return BigInt(await rpc<string>("eth_blockNumber"));
}
