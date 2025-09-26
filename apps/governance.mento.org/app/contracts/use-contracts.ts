import { Alfajores, Celo } from "@repo/web3";
import { MentoChainContracts } from "@repo/web3";
import { IS_PROD } from "@repo/web3";
import { useAccount, useChains } from "wagmi";

export const useContracts = (): MentoChainContracts => {
  const chains = useChains();
  const { isConnected, chainId } = useAccount();

  // In production, only allow Celo contracts
  if (IS_PROD) return Celo.contracts as MentoChainContracts;

  return isConnected && (chainId === Celo.id || chainId === Alfajores.id)
    ? (chains.find((chain) => chain.id === chainId)
        ?.contracts as MentoChainContracts)
    : (Celo.contracts as MentoChainContracts);
};
