import { CeloSepolia, Celo } from "../../config/chains";
import { IS_PROD } from "../../utils/environment";
import { MentoChainContracts } from "../../types";
import { useAccount, useChains } from "wagmi";

export const useContracts = (): MentoChainContracts => {
  const chains = useChains();
  const { isConnected, chainId } = useAccount();
  const isKnownChain = chainId === Celo.id || chainId === CeloSepolia.id;

  // In production, only allow Celo contracts
  if (IS_PROD) return Celo.contracts as MentoChainContracts;

  return isConnected && isKnownChain
    ? (chains.find((chain) => chain.id === chainId)
        ?.contracts as MentoChainContracts)
    : (Celo.contracts as MentoChainContracts);
};
