import { Alfajores, Celo } from "@repo/web3";

export const ensureChainId = (chainId?: number) => {
  if (chainId !== Celo.id && chainId !== Alfajores.id) {
    return Celo.id;
  } else {
    return chainId;
  }
};
