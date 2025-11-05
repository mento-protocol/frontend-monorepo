"use client";

import { ContractInfo } from "../types/transaction";
import { normalizeAddress, formatAddress } from "../utils/address-utils";
import contractsConfig from "../config/contract-registry.json";
import { ContractAPIService } from "./contract-api-service";
import * as Sentry from "@sentry/nextjs";

interface ResolvedAddress {
  address: string;
  name: string;
  friendlyName?: string;
  symbol?: string;
  decimals?: number;
  isProxy?: boolean;
  implementationAddress?: string;
  source: "local" | "api" | "formatted";
}

interface CachedResolvedAddress {
  resolved: ResolvedAddress;
  timestamp: number;
}

/**
 * Unified service for resolving addresses to human-readable names and information.
 * Consolidates local contract registry, API calls, and formatting logic.
 */
class AddressResolverService {
  private cache = new Map<string, CachedResolvedAddress>();
  private contractAPIService: ContractAPIService;

  // Cache duration: 30 minutes
  private readonly CACHE_DURATION = 30 * 60 * 1000;

  // Track pending requests to prevent duplicates
  private readonly pendingRequests = new Map<
    string,
    Promise<ResolvedAddress>
  >();

  // Local contract registry (created once at instantiation)
  private readonly localRegistry: Record<string, ContractInfo>;

  constructor(contractAPIService?: ContractAPIService) {
    this.contractAPIService = contractAPIService || new ContractAPIService();
    this.localRegistry = this.createLocalRegistry();
  }

  /**
   * Resolve an address to human-readable information
   */
  async resolve(address: string | null | undefined): Promise<ResolvedAddress> {
    if (!address) {
      return {
        address: "",
        name: "Unknown",
        source: "formatted",
      };
    }

    const normalizedAddress = normalizeAddress(address);

    // Check cache first
    const cached = this.cache.get(normalizedAddress);
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      return cached.resolved;
    }

    // Check for pending request
    const pendingRequest = this.pendingRequests.get(normalizedAddress);
    if (pendingRequest) {
      return pendingRequest;
    }

    // Create and track the resolution request
    const requestPromise = this.performResolution(normalizedAddress);
    this.pendingRequests.set(normalizedAddress, requestPromise);

    try {
      const resolved = await requestPromise;

      // Cache the result
      this.cache.set(normalizedAddress, {
        resolved,
        timestamp: Date.now(),
      });

      return resolved;
    } catch (error) {
      Sentry.withScope((scope) => {
        scope.setTag("component", "address-resolver-service");
        scope.setContext("address", { address: normalizedAddress });
        Sentry.captureException(error);
      });

      console.error(`Failed to resolve address ${normalizedAddress}:`, error);

      // Return formatted address as fallback
      return {
        address: normalizedAddress,
        name: formatAddress(normalizedAddress),
        source: "formatted",
      };
    } finally {
      // Clean up pending request
      this.pendingRequests.delete(normalizedAddress);
    }
  }

  /**
   * Synchronously resolve address using only local registry (for immediate use)
   */
  resolveFromCache(address: string | null | undefined): ResolvedAddress {
    if (!address) {
      return {
        address: "",
        name: "Unknown",
        source: "formatted",
      };
    }

    const normalizedAddress = normalizeAddress(address);

    // Check cache first
    const cached = this.cache.get(normalizedAddress);
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      return cached.resolved;
    }

    // Check local registry
    const localInfo = this.localRegistry[normalizedAddress];
    if (localInfo) {
      const resolved: ResolvedAddress = {
        address: normalizedAddress,
        name: localInfo.friendlyName || localInfo.name,
        friendlyName: localInfo.friendlyName,
        symbol: localInfo.symbol,
        decimals: localInfo.decimals,
        isProxy: localInfo.isProxy,
        implementationAddress: localInfo.implementationAddress,
        source: "local",
      };

      // Cache the result
      this.cache.set(normalizedAddress, {
        resolved,
        timestamp: Date.now(),
      });

      return resolved;
    }

    // Return formatted address as fallback
    return {
      address: normalizedAddress,
      name: formatAddress(normalizedAddress),
      source: "formatted",
    };
  }

  /**
   * Resolve address specifically for rate feeds
   */
  async resolveRateFeed(
    address: string | null | undefined,
  ): Promise<ResolvedAddress> {
    if (!address) {
      return {
        address: "",
        name: "Unknown rate feed",
        source: "formatted",
      };
    }

    // Check if this address has a specific rate feed mapping
    const rateFeedName =
      contractsConfig.rateFeeds[
        address as keyof typeof contractsConfig.rateFeeds
      ];

    if (rateFeedName) {
      return {
        address: normalizeAddress(address),
        name: rateFeedName,
        source: "local",
      };
    }

    // Fall back to regular resolution
    const resolved = await this.resolve(address);

    // Special handling for SortedOracles
    if (resolved.source === "local" && resolved.name === "SortedOracles") {
      return {
        ...resolved,
        name: resolved.symbol || resolved.friendlyName || resolved.name,
      };
    }

    return resolved;
  }

  /**
   * Get multiple resolved addresses efficiently
   */
  async resolveMultiple(
    addresses: (string | null | undefined)[],
  ): Promise<ResolvedAddress[]> {
    const uniqueAddresses = Array.from(
      new Set(addresses.filter(Boolean) as string[]),
    );

    // Resolve all unique addresses in parallel
    const resolvedMap = new Map<string, ResolvedAddress>();
    await Promise.all(
      uniqueAddresses.map(async (address) => {
        const resolved = await this.resolve(address);
        resolvedMap.set(normalizeAddress(address), resolved);
      }),
    );

    // Map back to original array order, handling duplicates and nulls
    return addresses.map((address) => {
      if (!address) {
        return {
          address: "",
          name: "Unknown",
          source: "formatted" as const,
        };
      }
      return resolvedMap.get(normalizeAddress(address))!;
    });
  }

  /**
   * Get contract info from local registry only
   */
  getLocalContractInfo(
    address: string | null | undefined,
  ): ContractInfo | null {
    if (!address) return null;
    const normalizedAddress = normalizeAddress(address);
    return this.localRegistry[normalizedAddress] || null;
  }

  /**
   * Get all contract mappings from local registry
   */
  getAllLocalMappings(): Array<{
    name: string;
    address: string;
    friendlyName?: string;
    symbol?: string;
  }> {
    return Object.entries(this.localRegistry).map(([address, info]) => ({
      name: info.name,
      address,
      friendlyName: info.friendlyName,
      symbol: info.symbol,
    }));
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.cache.clear();
    this.pendingRequests.clear();
  }

  /**
   * Perform the actual address resolution with fallback strategy
   */
  private async performResolution(
    normalizedAddress: string,
  ): Promise<ResolvedAddress> {
    // 1. Try local registry first (fastest)
    const localInfo = this.localRegistry[normalizedAddress];
    if (localInfo) {
      return {
        address: normalizedAddress,
        name: localInfo.friendlyName || localInfo.name,
        friendlyName: localInfo.friendlyName,
        symbol: localInfo.symbol,
        decimals: localInfo.decimals,
        isProxy: localInfo.isProxy,
        implementationAddress: localInfo.implementationAddress,
        source: "local",
      };
    }

    // 2. Try API resolution (slower but more comprehensive)
    try {
      const apiInfo =
        await this.contractAPIService.getContractInfo(normalizedAddress);
      if (apiInfo?.name) {
        return {
          address: normalizedAddress,
          name: apiInfo.name,
          friendlyName: apiInfo.friendlyName,
          symbol: apiInfo.symbol,
          decimals: apiInfo.decimals,
          isProxy: apiInfo.isProxy,
          implementationAddress: apiInfo.implementationAddress,
          source: "api",
        };
      }
    } catch (error) {
      console.warn(`API resolution failed for ${normalizedAddress}:`, error);
    }

    // 3. Fallback to formatted address
    return {
      address: normalizedAddress,
      name: formatAddress(normalizedAddress),
      source: "formatted",
    };
  }

  /**
   * Create the local contract registry from the JSON config
   */
  private createLocalRegistry(): Record<string, ContractInfo> {
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
  }
}

// Create singleton instance
export const addressResolverService = new AddressResolverService();

// Convenience functions for backward compatibility and ease of use

/**
 * Get address name (sync version using local registry only)
 */
export function getAddressNameFromCache(
  address: string | null | undefined,
): string {
  const resolved = addressResolverService.resolveFromCache(address);
  return resolved.name;
}

/**
 * Get contract info (local registry only)
 */
export function getContractInfo(
  address: string | null | undefined,
): ContractInfo | null {
  return addressResolverService.getLocalContractInfo(address);
}
