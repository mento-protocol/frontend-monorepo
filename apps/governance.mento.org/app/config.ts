import { celoSepolia } from "viem/chains";
import { celo } from "wagmi/chains";

export const subgraphApiNames = {
  [celoSepolia.id]: "subgraphCeloSepolia",
  [celo.id]: "subgraph",
  // Considered default
  [0]: "subgraph",
};

export const isValidChainId = (
  k: number,
): k is keyof typeof subgraphApiNames => {
  return k in subgraphApiNames;
};
export const getSubgraphApiName = (chainId: number | undefined) => {
  if (!chainId || !isValidChainId(chainId)) return subgraphApiNames[0];
  return subgraphApiNames[chainId];
};
