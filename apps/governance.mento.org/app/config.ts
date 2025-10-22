import { celoSepolia } from "viem/chains";
import { celo } from "wagmi/chains";

const subgraphApiNames = {
  [celoSepolia.id]: "subgraphCeloSepolia",
  [celo.id]: "subgraph",
  // Considered default
  [0]: "subgraph",
};

const isValidChainId = (k: number): k is keyof typeof subgraphApiNames => {
  return k in subgraphApiNames;
};
export const getSubgraphApiName = (chainId: number | undefined) => {
  if (!chainId || !isValidChainId(chainId)) return subgraphApiNames[0];
  return subgraphApiNames[chainId];
};

export const WATCHDOG_MULTISIG_ADDRESSES = {
  [celo.id]: "0xE6951C4176aaB41097C6f5fE11e9c515B7108acd" as const,
  [celoSepolia.id]: "0x56fD3F2bEE130e9867942D0F463a16fBE49B8d81" as const,
  [0]: "0xE6951C4176aaB41097C6f5fE11e9c515B7108acd" as const, // Default (mainnet)
};

export const getWatchdogMultisigAddress = (chainId: number | undefined) => {
  if (!chainId || !isValidChainId(chainId))
    return WATCHDOG_MULTISIG_ADDRESSES[0];
  return WATCHDOG_MULTISIG_ADDRESSES[chainId];
};
