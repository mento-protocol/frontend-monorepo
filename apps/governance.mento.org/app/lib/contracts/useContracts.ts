import { useAccount, useChains } from "wagmi";
import { MentoChain, MentoChainContracts } from "@/lib/types";
import { Celo, Alfajores } from "@/lib/config/chains";
import { IS_PROD } from "../../middleware";

export const useContracts = (): MentoChainContracts => {
  const chains = useChains();
  const { isConnected, chainId } = useAccount();

  // In production, only allow Celo contracts
  if (IS_PROD) return Celo.contracts;

  return isConnected && (chainId === Celo.id || chainId === Alfajores.id)
    ? (chains.find((chain) => chain.id === chainId) as MentoChain).contracts
    : Celo.contracts;
};
