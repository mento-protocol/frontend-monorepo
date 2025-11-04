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
// Local Otterscan block explorer for forks
const forkBlockExplorer = {
  name: "Otterscan (Local)",
  url: "http://localhost:5100",
};

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

export const CeloMainnetFork: MentoChain = {
  id: ChainId.Celo,
  name: "Celo Mainnet Fork",
  nativeCurrency: {
    decimals: 18,
    name: "CELO",
    symbol: "CELO",
  },
  blockExplorers: { default: forkBlockExplorer },
  rpcUrls: {
    default: {
      http: ["http://localhost:8545"],
    },
  },
  contracts: {
    ...celo.contracts,
    ...transformToChainContracts(addresses[ChainId.Celo]),
  },
} as const satisfies Chain;

export const CeloSepoliaFork: MentoChain = {
  id: ChainId.CeloSepolia,
  name: "Celo Sepolia Fork",
  nativeCurrency: {
    decimals: 18,
    name: "CELO",
    symbol: "CELO",
  },
  blockExplorers: { default: forkBlockExplorer },
  rpcUrls: {
    default: {
      http: ["http://localhost:8545"],
    },
  },
  contracts: {
    ...celoSepolia.contracts,
    ...transformToChainContracts(addresses[ChainId.CeloSepolia]),
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

const useFork = isForkModeEnabled();

export const chainIdToChain: Record<number, MentoChain> = {
  [ChainId.CeloSepolia]: useFork ? CeloSepoliaFork : CeloSepolia,
  [ChainId.Celo]: useFork ? CeloMainnetFork : Celo,
};

export const allChains = useFork
  ? ([CeloMainnetFork, CeloSepoliaFork] as const satisfies readonly [
      MentoChain,
      ...MentoChain[],
    ])
  : ([Celo, CeloSepolia] as const satisfies readonly [
      MentoChain,
      ...MentoChain[],
    ]);

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
