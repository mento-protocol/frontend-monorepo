import { MentoChain, MentoChainContracts } from "@/types";
import { addresses, ContractAddresses } from "@mento-protocol/mento-sdk";
import { Address, Chain } from "viem";
import { celo, celoAlfajores } from "wagmi/chains";

export enum ChainId {
  Alfajores = 44787,
  Celo = 42220,
}

export const Alfajores: MentoChain = {
  ...celoAlfajores,
  contracts: {
    ...celoAlfajores.contracts,
    ...transformToChainContracts(addresses[celoAlfajores.id]),
  },
} as const satisfies Chain;

export const Celo: MentoChain = {
  ...celo,
  contracts: {
    ...celo.contracts,
    ...transformToChainContracts(addresses[celo.id]),
  },
} as const satisfies Chain;

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
