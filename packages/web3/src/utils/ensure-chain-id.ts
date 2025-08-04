import { Alfajores, Celo } from "@/config/chains";

export const ensureChainId = (chainId?: number) => {
  if (chainId !== Celo.chainId && chainId !== Alfajores.chainId) {
    return Celo.chainId;
  } else {
    return chainId;
  }
};
