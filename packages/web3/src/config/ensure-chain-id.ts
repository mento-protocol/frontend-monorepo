import { CeloSepolia, Celo } from "@/config/chains";

export const ensureChainId = (chainId?: number) => {
  if (chainId !== Celo.id && chainId !== CeloSepolia.id) {
    return Celo.id;
  } else {
    return chainId;
  }
};
