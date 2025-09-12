"use client";

import { useMemo } from "react";
import { ContractInfo } from "../types/transaction";
import { normalizeAddress, formatAddress } from "../utils/address-utils";
import contractsConfig from "../config/contract-registry.json";

// Flatten the contract registry for efficient lookup
const createContractRegistry = (): Record<string, ContractInfo> => {
  const registry: Record<string, ContractInfo> = {};

  Object.entries(contractsConfig).forEach(([categoryName, category]) => {
    Object.entries(category).forEach(([address, info]) => {
      if (categoryName === "rateFeeds") {
        // Handle rate feeds which are just string names
        registry[normalizeAddress(address)] = {
          name: info as string,
        };
      } else {
        // Handle regular contract info objects
        registry[normalizeAddress(address)] = info as ContractInfo;
      }
    });
  });

  return registry;
};

// Create the registry once at module level
const CONTRACT_REGISTRY = createContractRegistry();

/**
 * Hook to get contract information with memoization
 */
export function useContractInfo(
  address: string | null | undefined,
): ContractInfo | null {
  return useMemo(() => {
    if (!address) return null;

    const normalizedAddress = normalizeAddress(address);
    return CONTRACT_REGISTRY[normalizedAddress] || null;
  }, [address]);
}

/**
 * Hook to get contract name or formatted address
 */
export function useContractName(address: string | null | undefined): string {
  const contractInfo = useContractInfo(address);

  return useMemo(() => {
    if (!address) return "Unknown";
    return contractInfo?.name || formatAddress(address);
  }, [address, contractInfo?.name]);
}

/**
 * Hook to get friendly display name for an address
 */
export function useAddressName(address: string | null | undefined): string {
  const contractInfo = useContractInfo(address);

  return useMemo(() => {
    if (!address) return "Unknown";

    if (contractInfo?.friendlyName) {
      return contractInfo.friendlyName;
    }
    if (contractInfo?.name) {
      return contractInfo.name;
    }
    return formatAddress(address);
  }, [address, contractInfo]);
}

/**
 * Hook to get all contract mappings for friendly name lookup
 */
export function useAllContractMappings(): Array<{
  name: string;
  address: string;
  friendlyName?: string;
  symbol?: string;
}> {
  return useMemo(() => {
    return Object.entries(CONTRACT_REGISTRY).map(([address, info]) => ({
      name: info.name,
      address,
      friendlyName: info.friendlyName,
      symbol: info.symbol,
    }));
  }, []);
}

/**
 * Hook to get rate feed display name
 */
export function useRateFeedName(address: string | null | undefined): string {
  const contractInfo = useContractInfo(address);

  return useMemo(() => {
    if (!address) return "Unknown rate feed";

    // Check if this address has a specific rate feed mapping
    const rateFeedName =
      contractsConfig.rateFeeds[
        address as keyof typeof contractsConfig.rateFeeds
      ];
    if (rateFeedName) {
      return rateFeedName;
    }

    if (contractInfo?.name === "SortedOracles") {
      return (
        contractInfo.symbol || contractInfo.friendlyName || contractInfo.name
      );
    }

    return useAddressName(address);
  }, [address, contractInfo]);
}

/**
 * Get contract info directly (non-hook version for use in utilities)
 */
export function getContractInfo(
  address: string | null | undefined,
): ContractInfo | null {
  if (!address) return null;

  const normalizedAddress = normalizeAddress(address);
  return CONTRACT_REGISTRY[normalizedAddress] || null;
}

/**
 * Get address name directly (non-hook version for use in utilities)
 */
export function getAddressName(address: string | null | undefined): string {
  if (!address) return "Unknown";

  const contractInfo = getContractInfo(address);

  if (contractInfo?.friendlyName) {
    return contractInfo.friendlyName;
  }
  if (contractInfo?.name) {
    return contractInfo.name;
  }
  return formatAddress(address);
}

/**
 * Get rate feed name directly (non-hook version for use in utilities)
 */
export function getRateFeedName(address: string | null | undefined): string {
  if (!address) return "Unknown rate feed";

  // Check if this address has a specific rate feed mapping
  const rateFeedName =
    contractsConfig.rateFeeds[
      address as keyof typeof contractsConfig.rateFeeds
    ];
  if (rateFeedName) {
    return rateFeedName;
  }

  const contractInfo = getContractInfo(address);
  if (contractInfo?.name === "SortedOracles") {
    return (
      contractInfo.symbol || contractInfo.friendlyName || contractInfo.name
    );
  }

  return getAddressName(address);
}
