import { ChainId } from "@repo/web3";

/**
 * Swapping is handled by an external aggregator rather than an in-app swap
 * page. Squid has the broadest Mento coverage on Celo; on Polygon and Monad,
 * where Squid does not support Mento stables yet, Matcha is used instead.
 */
export const SQUID_SWAP_URL = "https://app.squidrouter.com/";
export const MATCHA_SWAP_URL = "https://matcha.xyz/";

export interface SwapAggregator {
  name: "Squid" | "Matcha";
  url: string;
}

const SQUID: SwapAggregator = { name: "Squid", url: SQUID_SWAP_URL };
const MATCHA: SwapAggregator = { name: "Matcha", url: MATCHA_SWAP_URL };

const MATCHA_CHAIN_IDS: ReadonlySet<number> = new Set([
  ChainId.Polygon,
  ChainId.PolygonAmoy,
  ChainId.Monad,
  ChainId.MonadTestnet,
]);

/** The aggregator to send a user to for swaps on the given chain. */
export function swapAggregatorForChain(chainId: number): SwapAggregator {
  return MATCHA_CHAIN_IDS.has(chainId) ? MATCHA : SQUID;
}
