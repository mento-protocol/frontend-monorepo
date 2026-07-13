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
