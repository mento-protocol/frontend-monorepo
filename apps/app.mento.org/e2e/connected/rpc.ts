// The Celo connected fork runs on 127.0.0.1:8545 (pnpm fork:mainnet); the Monad
// connected fork runs on 127.0.0.1:8546 (pnpm fork:monad). The helpers are built
// per-URL so a spec targets exactly one fork — createRpcClient(url) — and the
// default-bound named exports below keep the existing 8545 (Celo) specs working
// unchanged.
const DEFAULT_RPC_URL = "http://127.0.0.1:8545";

export interface RpcClient {
  rpc: <T>(method: string, params?: unknown[]) => Promise<T>;
  snapshot: () => Promise<string>;
  revert: (id: string) => Promise<boolean>;
  erc20BalanceOf: (token: string, holder: string) => Promise<bigint>;
}

export function createRpcClient(rpcUrl: string = DEFAULT_RPC_URL): RpcClient {
  async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
    const response = await fetch(rpcUrl, {
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

  const snapshot = () => rpc<string>("evm_snapshot");
  const revert = (id: string) => rpc<boolean>("evm_revert", [id]);

  async function erc20BalanceOf(
    token: string,
    holder: string,
  ): Promise<bigint> {
    const data = `0x70a08231${holder.slice(2).toLowerCase().padStart(64, "0")}`;
    return BigInt(
      await rpc<string>("eth_call", [{ to: token, data }, "latest"]),
    );
  }

  return { rpc, snapshot, revert, erc20BalanceOf };
}

// Default client, bound to the Celo fork (8545) — preserves the named exports
// the existing swap*.spec.ts files already import.
export const { rpc, snapshot, revert, erc20BalanceOf } = createRpcClient();
