import { ChainId } from "@/config/chains";

// Mento V3 trove-history subgraph endpoints, keyed by chainId. Celo mainnet
// will get its own URL once that subgraph is published to The Graph's
// decentralized network; Celo Sepolia stays on Studio (the decentralized
// network doesn't support that testnet).
const TROVES_SUBGRAPH_URLS: Partial<Record<ChainId, string>> = {
  [ChainId.CeloSepolia]:
    "https://api.studio.thegraph.com/query/1724470/mento-troves-celo-sepolia/version/latest",
};

export function getTrovesSubgraphUrl(chainId: number): string | undefined {
  return TROVES_SUBGRAPH_URLS[chainId as ChainId];
}
