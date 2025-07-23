import { Alfajores, Celo } from "@/lib/config/chains";
import { MentoChainContracts } from "@/lib/types";
import { IS_PROD } from "@/middleware";
import { useAccount } from "wagmi";

export const useContracts = (): MentoChainContracts => {
  const { isConnected, chainId } = useAccount();

  if (IS_PROD) return Celo.contracts;

  return isConnected && (chainId === Celo.id || chainId === Alfajores.id)
    ? Alfajores.contracts
    : Celo.contracts;
};
