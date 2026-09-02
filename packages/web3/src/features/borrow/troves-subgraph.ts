import { ChainId } from "@/config/chains";

// Mento V3 trove-history subgraph endpoints, keyed by chainId. Both networks
// currently serve from Subgraph Studio. Celo Sepolia will stay on Studio
// permanently (The Graph's decentralized network doesn't support that
// testnet). Celo mainnet will switch to a decentralized-network gateway
// URL once that subgraph is published — until then, Studio is fine for
// development and the early user-facing rollout.
//
// The version label is part of the path and MUST be an explicit one that
// exists in Studio. `/version/latest` is not an alias — Studio resolves that
// last segment as a literal version label, so it 200s with a GraphQL error
// (`deployment u<account>/s<subgraph>/latest does not exist`) unless a version
// was literally labelled "latest". That is what broke this panel (#865).
//
// Studio also archives the previous version on every new deploy, and archived
// versions stop answering queries. So bumping the subgraph in
// mento-protocol/bold (`subgraph/deploy-subgraph <network> --version vX.Y.Z`)
// breaks this file until the label below is bumped to match. Keep the two in
// lockstep, or move mainnet to the gateway URL where the subgraph id is stable
// across version publishes.
const TROVES_SUBGRAPH_URLS: Partial<Record<ChainId, string>> = {
  [ChainId.Celo]:
    "https://api.studio.thegraph.com/query/1724470/mento-troves-celo/v0.0.1",
  [ChainId.CeloSepolia]:
    "https://api.studio.thegraph.com/query/1724470/mento-troves-celo-sepolia/v0.0.1",
};

export function getTrovesSubgraphUrl(chainId: number): string | undefined {
  return TROVES_SUBGRAPH_URLS[chainId as ChainId];
}
