import { CeloSepolia, Celo } from "../../config/chains";
import { MentoChainContracts } from "../../types";
import { useAccount, useChains } from "wagmi";

export const useContracts = (): MentoChainContracts => {
  const chains = useChains();
  const { isConnected, chainId } = useAccount();
  const isKnownChain = chainId === Celo.id || chainId === CeloSepolia.id;

  return isConnected && isKnownChain
    ? (chains.find((chain) => chain.id === chainId)
        ?.contracts as MentoChainContracts)
    : (Celo.contracts as MentoChainContracts);
};
