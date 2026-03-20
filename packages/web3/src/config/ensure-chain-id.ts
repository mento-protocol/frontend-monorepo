import { chainIdToChain, Celo } from "@/config/chains";

export const ensureChainId = (chainId?: number) => {
  if (chainId !== undefined && chainId in chainIdToChain) {
    return chainId;
  }
  return Celo.id;
};
