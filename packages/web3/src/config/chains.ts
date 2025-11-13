import { addresses, ContractAddresses } from "@mento-protocol/mento-sdk";
import { Address, Chain } from "viem";
import { celoSepolia } from "viem/chains";
import { celo } from "wagmi/chains";
import { MentoChain, MentoChainContracts } from "../types";

const useFork = isForkModeEnabled();

export enum ChainId {
  CeloSepolia = 11142220,
  Celo = 42220,
}

const LOCAL_FORK_EXPLORER = {
  name: "Otterscan (Local Fork)",
  url: "http://localhost:5100",
};
export const CELO_EXPLORER = {
  name: "Celo Explorer",
  url: "https://celoscan.io",
};
export const CELO_SEPOLIA_EXPLORER = {
  name: "Celo Sepolia Explorer",
  url: "https://sepolia.celoscan.io",
  apiUrl: "https://sepolia.celoscan.io/api",
};

export const CeloSepolia: MentoChain = {
  ...celoSepolia,
  id: ChainId.CeloSepolia,
  nativeCurrency: {
    decimals: 18,
    name: "CELO",
    symbol: "CELO",
  },
  blockExplorers: {
    default: useFork ? LOCAL_FORK_EXPLORER : CELO_SEPOLIA_EXPLORER,
  },
  rpcUrls: {
    default: {
      http: [
        useFork
          ? "http://localhost:8545"
          : "https://forno.celo-sepolia.celo-testnet.org",
      ],
    },
  },
  contracts: {
    ...celoSepolia.contracts,
    ...transformToChainContracts(addresses[celoSepolia.id]),
  },
} as const satisfies Chain;

export const Celo: MentoChain = {
  ...celo,
  id: ChainId.Celo,
  nativeCurrency: {
    decimals: 18,
    name: "CELO",
    symbol: "CELO",
  },
  blockExplorers: { default: useFork ? LOCAL_FORK_EXPLORER : CELO_EXPLORER },
  rpcUrls: {
    default: {
      http: [useFork ? "http://localhost:8545" : "https://forno.celo.org"],
    },
  },
  contracts: {
    ...celo.contracts,
    ...transformToChainContracts(addresses[celo.id]),
  },
} as const satisfies Chain;

function isForkModeEnabled(): boolean {
  // Check environment variable (works during build and SSR)
  if (process.env.NEXT_PUBLIC_USE_FORK === "true") {
    return true;
  }

  // Check localStorage (works in browser for runtime toggling)
  if (typeof window !== "undefined") {
    const storedValue = localStorage.getItem("mento_use_fork");
    if (storedValue !== null) {
      return storedValue === "true";
    }
  }

  return false;
}

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
