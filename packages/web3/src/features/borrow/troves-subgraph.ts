import { ChainId } from "@/config/chains";

// Mento V3 trove-history subgraph endpoints, keyed by chainId. Both networks
// currently serve from Subgraph Studio. Celo Sepolia will stay on Studio
// permanently (The Graph's decentralized network doesn't support that
// testnet). Celo mainnet will switch to a decentralized-network gateway
// URL once that subgraph is published — until then, Studio is fine for
// development and the early user-facing rollout.
const TROVES_SUBGRAPH_URLS: Partial<Record<ChainId, string>> = {
  [ChainId.Celo]:
    "https://api.studio.thegraph.com/query/1724470/mento-troves-celo/version/latest",
  [ChainId.CeloSepolia]:
    "https://api.studio.thegraph.com/query/1724470/mento-troves-celo-sepolia/version/latest",
};

export function getTrovesSubgraphUrl(chainId: number): string | undefined {
  return TROVES_SUBGRAPH_URLS[chainId as ChainId];
}
