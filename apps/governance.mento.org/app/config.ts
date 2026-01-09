import { celoSepolia } from "viem/chains";
import { celo } from "wagmi/chains";

const subgraphApiNames = {
  [celoSepolia.id]: "subgraphCeloSepolia",
  [celo.id]: "subgraph",
  // Considered default
  [0]: "subgraph",
};

const isValidChainId = (k: number): k is keyof typeof subgraphApiNames => {
  return k in subgraphApiNames;
};
export const getSubgraphApiName = (chainId: number | undefined) => {
  if (!chainId || !isValidChainId(chainId)) return subgraphApiNames[0];
  return subgraphApiNames[chainId];
};

const WATCHDOG_MULTISIG_ADDRESSES = {
  [celo.id]: "0xE6951C4176aaB41097C6f5fE11e9c515B7108acd" as const,
  [celoSepolia.id]: "0x56fD3F2bEE130e9867942D0F463a16fBE49B8d81" as const,
  [0]: "0xE6951C4176aaB41097C6f5fE11e9c515B7108acd" as const, // Default (mainnet)
};

export const getWatchdogMultisigAddress = (
  chainId: number | undefined,
): `0x${string}` => {
  if (!chainId || !isValidChainId(chainId)) {
    console.warn(
      `Invalid chainId ${chainId}, defaulting to mainnet watchdog address`,
    );
    return WATCHDOG_MULTISIG_ADDRESSES[0];
  }
  return WATCHDOG_MULTISIG_ADDRESSES[chainId];
};

/**
 * Chain ID to Safe network slug mapping
 */
const SAFE_NETWORK_SLUGS = {
  [celo.id]: "celo",
  [celoSepolia.id]: "celo-sepolia",
} as const;

/**
 * Get the Safe network slug for a given chain ID
 */
export const getSafeNetworkSlug = (chainId: number): string => {
  return (
    SAFE_NETWORK_SLUGS[chainId as keyof typeof SAFE_NETWORK_SLUGS] ?? "celo"
  );
};

/**
 * Build a Safe app URL for a given address and chain
 */
export const getSafeUrl = (
  chainId: number,
  safeAddress: string,
  path: string = "/home",
): string => {
  const networkSlug = getSafeNetworkSlug(chainId);
  return `https://app.safe.global${path}?safe=${networkSlug}:${safeAddress}`;
};

/**
 * Safe Transaction Service API URLs
 */
const SAFE_SERVICE_URLS = {
  [celo.id]: "https://safe-transaction-celo.safe.global",
  [celoSepolia.id]: "https://safe-transaction-celo-testnet.safe.global",
} as const;

/**
 * Get the Safe Transaction Service API URL for a given chain ID
 */
export const getSafeServiceUrl = (chainId: number): string => {
  const url = SAFE_SERVICE_URLS[chainId as keyof typeof SAFE_SERVICE_URLS];
  if (!url) {
    throw new Error(`Unsupported chain ID for Safe service: ${chainId}`);
  }
  return url;
};
