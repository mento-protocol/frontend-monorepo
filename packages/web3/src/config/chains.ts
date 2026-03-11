import { addresses, ContractAddresses } from "@mento-protocol/mento-sdk";
import { Address, Chain } from "viem";
import {
  celoSepolia,
  monad as viemMonad,
  monadTestnet as viemMonadTestnet,
} from "viem/chains";
import { celo } from "wagmi/chains";
import { MentoChain, MentoChainContracts } from "../types";
import celoIcon from "./chain-icons/celo.svg";
import monadIcon from "./chain-icons/monad.svg";

const useFork = isForkModeEnabled();

export enum ChainId {
  CeloSepolia = 11142220,
  Celo = 42220,
  MonadTestnet = 10143,
  Monad = 143,
}

const RPC_OVERRIDE_CONFIG: Record<
  ChainId,
  { envVar: string; envUrl: string | undefined; localStorageKey: string }
> = {
  [ChainId.CeloSepolia]: {
    envVar: "NEXT_PUBLIC_CELO_SEPOLIA_RPC_URL",
    envUrl: process.env.NEXT_PUBLIC_CELO_SEPOLIA_RPC_URL,
    localStorageKey: "mento_custom_rpc_url_11142220",
  },
  [ChainId.Celo]: {
    envVar: "NEXT_PUBLIC_CELO_RPC_URL",
    envUrl: process.env.NEXT_PUBLIC_CELO_RPC_URL,
    localStorageKey: "mento_custom_rpc_url_42220",
  },
  [ChainId.MonadTestnet]: {
    envVar: "NEXT_PUBLIC_MONAD_TESTNET_RPC_URL",
    envUrl: process.env.NEXT_PUBLIC_MONAD_TESTNET_RPC_URL,
    localStorageKey: "mento_custom_rpc_url_10143",
  },
  [ChainId.Monad]: {
    envVar: "NEXT_PUBLIC_MONAD_RPC_URL",
    envUrl: process.env.NEXT_PUBLIC_MONAD_RPC_URL,
    localStorageKey: "mento_custom_rpc_url_143",
  },
};

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
export const MONAD_EXPLORER = {
  name: "Monad Explorer",
  url: "https://monadvision.com",
};
export const MONAD_TESTNET_EXPLORER = {
  name: "Monad Testnet Explorer",
  url: "https://testnet.monadexplorer.com",
};

export const CeloSepolia: MentoChain = {
  ...celoSepolia,
  id: ChainId.CeloSepolia,
  iconUrl: celoIcon,
  iconBackground: "#FCFF52",
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
      http: [getCeloSepoliaRpcUrl()],
    },
  },
  contracts: {
    ...celoSepolia.contracts,
    ...transformToChainContracts(addresses[celoSepolia.id]),
  },
} as const satisfies MentoChain;

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
      http: [getCeloRpcUrl()],
    },
  },
  contracts: {
    ...celo.contracts,
    ...transformToChainContracts(addresses[celo.id]),
  },
} as const satisfies Chain;

export const MonadTestnet: MentoChain = {
  ...viemMonadTestnet,
  id: ChainId.MonadTestnet,
  iconUrl: monadIcon,
  iconBackground: "transparent",
  nativeCurrency: {
    decimals: 18,
    name: "MON",
    symbol: "MON",
  },
  blockExplorers: {
    default: MONAD_TESTNET_EXPLORER,
  },
  rpcUrls: {
    ...viemMonadTestnet.rpcUrls,
    default: {
      http: [getMonadTestnetRpcUrl()],
    },
  },
  contracts: {
    ...viemMonadTestnet.contracts,
    ...transformToChainContracts(
      addresses[ChainId.MonadTestnet as unknown as keyof typeof addresses],
    ),
  },
} as const satisfies MentoChain;

export const Monad: MentoChain = {
  ...viemMonad,
  id: ChainId.Monad,
  iconUrl: monadIcon,
  iconBackground: "transparent",
  nativeCurrency: {
    decimals: 18,
    name: "MON",
    symbol: "MON",
  },
  blockExplorers: {
    default: MONAD_EXPLORER,
  },
  rpcUrls: {
    ...viemMonad.rpcUrls,
    default: {
      http: [getMonadRpcUrl()],
    },
  },
  contracts: {
    ...viemMonad.contracts,
    ...transformToChainContracts(
      addresses[ChainId.Monad as unknown as keyof typeof addresses],
    ),
  },
} as const satisfies MentoChain;

function isForkModeEnabled(): boolean {
  if (typeof window === "undefined") {
    // During SSR, check environment variable
    return process.env.NEXT_PUBLIC_USE_FORK === "true";
  }

  // In browser, check localStorage first, then environment variable
  const storedValue = localStorage.getItem("mento_use_fork");
  if (storedValue !== null) {
    return storedValue === "true";
  }

  // Check environment variable as fallback
  if (process.env.NEXT_PUBLIC_USE_FORK === "true") {
    return true;
  }

  // Default to false (fork mode disabled)
  return false;
}

function getLegacyCustomRpcUrl(): string | undefined {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("mento_custom_rpc_url");
    if (stored) return stored;
  }
  return process.env.NEXT_PUBLIC_RPC_URL || undefined;
}

function getChainSpecificRpcUrl(
  chainId: ChainId,
): { url: string; source: string } | undefined {
  const config = RPC_OVERRIDE_CONFIG[chainId];

  if (typeof window !== "undefined") {
    const stored = localStorage.getItem(config.localStorageKey);
    if (stored) {
      return {
        url: stored,
        source: `custom RPC (${config.localStorageKey})`,
      };
    }
  }

  const envUrl = config.envUrl;
  if (envUrl) {
    return {
      url: envUrl,
      source: `custom RPC (${config.envVar})`,
    };
  }

  // Keep the legacy global override only for Monad chains.
  if (chainId === ChainId.Monad || chainId === ChainId.MonadTestnet) {
    const legacyUrl = getLegacyCustomRpcUrl();
    if (legacyUrl) {
      return {
        url: legacyUrl,
        source: "custom RPC (NEXT_PUBLIC_RPC_URL / mento_custom_rpc_url)",
      };
    }
  }

  return undefined;
}

function getCeloSepoliaRpcUrl(): string {
  let url: string;
  let source: string;
  const override = getChainSpecificRpcUrl(ChainId.CeloSepolia);

  if (useFork) {
    url = "http://localhost:8545";
    source = "fork mode";
  } else if (override) {
    url = override.url;
    source = override.source;
  } else {
    url = "https://forno.celo-sepolia.celo-testnet.org";
    source = "default";
  }

  console.log(`[mento] Celo Sepolia RPC: ${url} (${source})`);
  return url;
}

function getCeloRpcUrl(): string {
  let url: string;
  let source: string;
  const override = getChainSpecificRpcUrl(ChainId.Celo);

  if (useFork) {
    url = "http://localhost:8545";
    source = "fork mode";
  } else if (override) {
    url = override.url;
    source = override.source;
  } else {
    url = "https://forno.celo.org";
    source = "default";
  }

  console.log(`[mento] Celo RPC: ${url} (${source})`);
  return url;
}

function getMonadTestnetRpcUrl(): string {
  let url: string;
  let source: string;
  const override = getChainSpecificRpcUrl(ChainId.MonadTestnet);

  if (override) {
    url = override.url;
    source = override.source;
  } else {
    url = "https://testnet-rpc.monad.xyz/";
    source = "default";
  }

  console.log(`[mento] Monad Testnet RPC: ${url} (${source})`);
  return url;
}

function getMonadRpcUrl(): string {
  let url: string;
  let source: string;
  const override = getChainSpecificRpcUrl(ChainId.Monad);

  if (override) {
    url = override.url;
    source = override.source;
  } else {
    url = "https://rpc.monad.xyz";
    source = "default";
  }

  console.log(`[mento] Monad RPC: ${url} (${source})`);
  return url;
}

export const chainIdToChain: Record<number, MentoChain> = {
  [ChainId.CeloSepolia]: CeloSepolia,
  [ChainId.Celo]: Celo,
  [ChainId.MonadTestnet]: MonadTestnet,
  [ChainId.Monad]: Monad,
};

export const allChains = [
  Celo,
  CeloSepolia,
  Monad,
  MonadTestnet,
] as const satisfies readonly [MentoChain, ...MentoChain[]];

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
