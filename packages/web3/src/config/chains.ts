import { addresses, ContractAddresses } from "@mento-protocol/mento-sdk";
import { Address } from "viem";
import {
  celoSepolia,
  monad as viemMonad,
  monadTestnet as viemMonadTestnet,
  polygonAmoy as viemPolygonAmoy,
  baseSepolia as viemBaseSepolia,
} from "viem/chains";
import { celo } from "wagmi/chains";
import { MentoChain, MentoChainContracts } from "../types";
import celoIcon from "./chain-icons/celo.svg";
import monadIcon from "./chain-icons/monad.svg";
import polygonIcon from "./chain-icons/polygon.svg";
import baseIcon from "./chain-icons/base.svg";
import { readStorageOverride } from "./rpc-overrides";

const useFork = isForkModeEnabled();

export enum ChainId {
  CeloSepolia = 11142220,
  Celo = 42220,
  MonadTestnet = 10143,
  Monad = 143,
  PolygonAmoy = 80002,
  BaseSepolia = 84532,
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
  [ChainId.PolygonAmoy]: {
    envVar: "NEXT_PUBLIC_POLYGON_AMOY_RPC_URL",
    envUrl: process.env.NEXT_PUBLIC_POLYGON_AMOY_RPC_URL,
    localStorageKey: "mento_custom_rpc_url_80002",
  },
  [ChainId.BaseSepolia]: {
    envVar: "NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL",
    envUrl: process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL,
    localStorageKey: "mento_custom_rpc_url_84532",
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
  url: "https://monadscan.com",
};
export const MONAD_TESTNET_EXPLORER = {
  name: "Monad Testnet Explorer",
  url: "https://testnet.monadscan.com",
};
export const POLYGON_AMOY_EXPLORER = {
  name: "PolygonScan (Amoy)",
  url: "https://amoy.polygonscan.com",
};
export const BASE_SEPOLIA_EXPLORER = {
  name: "Base Sepolia Explorer",
  url: "https://sepolia.basescan.org",
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
  iconUrl: celoIcon,
  iconBackground: "#FCFF52",
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
} as const satisfies MentoChain;

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

// Polygon Amoy enforces a minimum priority fee of 25 gwei; viem's RPC-based
// estimator routinely returns ~1.5 gwei. Keep a chain-level default here for
// viem estimation paths; wallet-submitted transactions also add explicit fee
// caps via getTransactionFeeOverrides().
const POLYGON_AMOY_DEFAULT_PRIORITY_FEE = 30_000_000_000n;

export const PolygonAmoy: MentoChain = {
  ...viemPolygonAmoy,
  id: ChainId.PolygonAmoy,
  iconUrl: polygonIcon,
  iconBackground: "transparent",
  nativeCurrency: {
    decimals: 18,
    name: "POL",
    symbol: "POL",
  },
  blockExplorers: {
    default: POLYGON_AMOY_EXPLORER,
  },
  rpcUrls: {
    ...viemPolygonAmoy.rpcUrls,
    default: {
      http: [getPolygonAmoyRpcUrl()],
    },
  },
  fees: {
    ...viemPolygonAmoy.fees,
    defaultPriorityFee: POLYGON_AMOY_DEFAULT_PRIORITY_FEE,
  },
  contracts: {
    ...viemPolygonAmoy.contracts,
    ...transformToChainContracts(
      addresses[ChainId.PolygonAmoy as unknown as keyof typeof addresses],
    ),
  },
} as const satisfies MentoChain;

export const BaseSepolia: MentoChain = {
  ...viemBaseSepolia,
  id: ChainId.BaseSepolia,
  iconUrl: baseIcon,
  iconBackground: "transparent",
  nativeCurrency: {
    decimals: 18,
    name: "ETH",
    symbol: "ETH",
  },
  blockExplorers: {
    default: BASE_SEPOLIA_EXPLORER,
  },
  rpcUrls: {
    ...viemBaseSepolia.rpcUrls,
    default: {
      http: [getBaseSepoliaRpcUrl()],
    },
  },
  contracts: {
    ...viemBaseSepolia.contracts,
    ...transformToChainContracts(
      addresses[ChainId.BaseSepolia as unknown as keyof typeof addresses],
    ),
  },
} as const satisfies MentoChain;

function isForkModeEnabled(): boolean {
  if (typeof window === "undefined") {
    // During SSR, check environment variable
    return process.env.NEXT_PUBLIC_USE_FORK === "true";
  }

  // In browser, check localStorage first, then environment variable
  const storedValue = readStorageOverride("mento_use_fork");
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
  const stored = readStorageOverride("mento_custom_rpc_url");
  if (stored) return stored;
  return process.env.NEXT_PUBLIC_RPC_URL || undefined;
}

function getChainSpecificRpcUrl(
  chainId: ChainId,
): { url: string; source: string } | undefined {
  const config = RPC_OVERRIDE_CONFIG[chainId];

  const stored = readStorageOverride(config.localStorageKey);
  if (stored) {
    return {
      url: stored,
      source: `custom RPC (${config.localStorageKey})`,
    };
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
  const override = getChainSpecificRpcUrl(ChainId.CeloSepolia);

  if (useFork) {
    url = "http://localhost:8545";
  } else if (override) {
    url = override.url;
  } else {
    url = "https://forno.celo-sepolia.celo-testnet.org";
  }

  return url;
}

function getCeloRpcUrl(): string {
  let url: string;
  const override = getChainSpecificRpcUrl(ChainId.Celo);

  if (useFork) {
    url = "http://localhost:8545";
  } else if (override) {
    url = override.url;
  } else {
    url = "https://forno.celo.org";
  }

  return url;
}

function getMonadTestnetRpcUrl(): string {
  let url: string;
  const override = getChainSpecificRpcUrl(ChainId.MonadTestnet);

  if (override) {
    url = override.url;
  } else {
    url = "https://testnet-rpc.monad.xyz/";
  }

  return url;
}

function getMonadRpcUrl(): string {
  let url: string;
  const override = getChainSpecificRpcUrl(ChainId.Monad);

  if (override) {
    url = override.url;
  } else {
    url = "https://rpc.monad.xyz";
  }

  return url;
}

function getPolygonAmoyRpcUrl(): string {
  const override = getChainSpecificRpcUrl(ChainId.PolygonAmoy);
  return override ? override.url : "https://polygon-amoy.drpc.org";
}

function getBaseSepoliaRpcUrl(): string {
  const override = getChainSpecificRpcUrl(ChainId.BaseSepolia);
  return override ? override.url : "https://sepolia.base.org";
}

export const chainIdToChain: Record<number, MentoChain> = {
  [ChainId.CeloSepolia]: CeloSepolia,
  [ChainId.Celo]: Celo,
  [ChainId.MonadTestnet]: MonadTestnet,
  [ChainId.Monad]: Monad,
  [ChainId.PolygonAmoy]: PolygonAmoy,
  [ChainId.BaseSepolia]: BaseSepolia,
};

export const allChains = [
  Celo,
  CeloSepolia,
  Monad,
  MonadTestnet,
  PolygonAmoy,
  BaseSepolia,
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
