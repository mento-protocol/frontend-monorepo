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
