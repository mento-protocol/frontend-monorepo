import { addresses, ContractAddresses } from "@mento-protocol/mento-sdk";
import { Address, Chain } from "viem";
import { celoSepolia } from "viem/chains";
import { celo } from "wagmi/chains";
import { MentoChain, MentoChainContracts } from "../types";

export enum ChainId {
  CeloSepolia = 11142220,
  Celo = 42220,
}

export const CELO_EXPLORER_URL = "https://celoscan.io";
export const CELO_SEPOLIA_EXPLORER_URL = "https://sepolia.celoscan.io";

export const CeloSepolia: MentoChain = {
  ...celoSepolia,
  blockExplorers: {
    default: {
      name: "Celo Sepolia Explorer",
      url: CELO_SEPOLIA_EXPLORER_URL,
      apiUrl: `${CELO_SEPOLIA_EXPLORER_URL}/api`,
    },
  },
  contracts: {
    ...celoSepolia.contracts,
    ...transformToChainContracts(addresses[celoSepolia.id]),
  },
} as const satisfies Chain;

export const Celo: MentoChain = {
  ...celo,
  blockExplorers: {
    default: {
      name: "Celo Explorer",
      url: CELO_EXPLORER_URL,
    },
  },
  rpcUrls: {
    default: {
      http: ["https://forno.celo.org"],
    },
  },
  contracts: {
    ...celo.contracts,
    ...transformToChainContracts(addresses[celo.id]),
  },
} as const satisfies Chain;

export const chainIdToChain: Record<number, MentoChain> = {
  [ChainId.CeloSepolia]: CeloSepolia,
  [ChainId.Celo]: Celo,
};

export const allChains = [Celo, CeloSepolia] as const satisfies readonly [
  MentoChain,
  ...MentoChain[],
];

/**
 * Transforms the specified Mento contract addresses to the format used by Viem.
 * @param contractAddresses The Mento contract addresses to be transformed.
 * @returns Mento contract addresses in the format used by Viem.
 */
function transformToChainContracts(
  contractAddresses: ContractAddresses | Partial<ContractAddresses> | undefined,
): MentoChainContracts {
  if (!contractAddresses) return {} as MentoChainContracts;
  const chainContracts: Partial<MentoChainContracts> = {};

  Object.keys(contractAddresses).forEach((key) => {
    const contractKey = key as keyof ContractAddresses;
    const address = contractAddresses[contractKey];
    if (address) {
      chainContracts[contractKey] = {
        address: address as Address,
      };
    }
  });

  return chainContracts as MentoChainContracts;
}
