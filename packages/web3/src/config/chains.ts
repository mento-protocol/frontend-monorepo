import { MentoChain, MentoChainContracts } from "@/types";
import { addresses, ContractAddresses } from "@mento-protocol/mento-sdk";
import { Address } from "viem";
import { celo, celoAlfajores } from "wagmi/chains";

export enum ChainId {
  Alfajores = 44787,
  Celo = 42220,
}

export const Alfajores: MentoChain = {
  id: ChainId.Alfajores,
  chainId: ChainId.Alfajores,
  name: "Alfajores",
  rpcUrl: "https://alfajores-forno.celo-testnet.org",
  explorerUrl: "https://alfajores.celoscan.io",
  explorerApiUrl: "https://api-alfajores.celoscan.io/api",
  contracts: {
    ...celoAlfajores.contracts,
    ...transformToChainContracts(addresses[celoAlfajores.id]),
  },
};

export const Celo: MentoChain = {
  id: ChainId.Celo,
  chainId: ChainId.Celo,
  name: "Celo",
  rpcUrl: "https://forno.celo.org",
  explorerUrl: "https://celoscan.io",
  explorerApiUrl: "https://api.celoscan.io/api",
  contracts: {
    ...celo.contracts,
    ...transformToChainContracts(addresses[celo.id]),
  },
};

export const chainIdToChain: Record<number, MentoChain> = {
  [ChainId.Alfajores]: Alfajores,
  [ChainId.Celo]: Celo,
};

export const allChains = [Celo, Alfajores];

/**
 * Transforms the specified Mento contract addresses to the format used by Viem.
 * @param contractAddresses The Mento contract addresses to be transformed.
 * @returns Mento contract addresses in the format used by Viem.
 */
function transformToChainContracts(
  contractAddresses: ContractAddresses | undefined,
): MentoChainContracts {
  if (!contractAddresses) throw new Error("Contract addresses not found");
  const chainContracts: Partial<MentoChainContracts> = {};

  Object.keys(contractAddresses).forEach((key) => {
    const contractKey = key as keyof ContractAddresses;
    chainContracts[contractKey] = {
      address: contractAddresses[contractKey] as Address,
    };
  });

  return chainContracts as MentoChainContracts;
}
