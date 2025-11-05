"use client";

import { ContractInfo } from "../types/transaction";
import { normalizeAddress } from "../utils/address-utils";
import * as Sentry from "@sentry/nextjs";

interface CachedABI {
  abi: unknown[];
  timestamp: number;
}

interface CachedContractInfo {
  info: ContractInfo;
  timestamp: number;
}

// Removed APIResponse interface as we now use internal APIs with different response format

/**
 * Service for fetching contract ABIs and information from block explorer APIs
 * Implements caching and fallback strategies for reliability
 */
export class ContractAPIService {
  private abiCache = new Map<string, CachedABI>();
  private contractInfoCache = new Map<string, CachedContractInfo>();

  // Cache duration: 1 hour for ABIs, 30 minutes for contract info
  private readonly ABI_CACHE_DURATION = 60 * 60 * 1000; // 1 hour
  private readonly INFO_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

  // Track in-progress requests to prevent duplicate API calls
  private readonly pendingABIRequests = new Map<
    string,
    Promise<unknown[] | null>
  >();
  private readonly pendingInfoRequests = new Map<
    string,
    Promise<ContractInfo | null>
  >();

  // Internal API endpoints (proxied to avoid CORS)
  private readonly INTERNAL_ABI_API = "/api/contract/abi";
  private readonly INTERNAL_INFO_API = "/api/contract/info";

  /**
   * Get contract ABI with caching and fallback
   */
  async getContractABI(address: string): Promise<unknown[] | null> {
    const normalizedAddress = normalizeAddress(address);

    // Check cache first
    const cached = this.abiCache.get(normalizedAddress);
    if (cached && Date.now() - cached.timestamp < this.ABI_CACHE_DURATION) {
      return cached.abi;
    }

    // Check if there's already a pending request for this address
    const pendingRequest = this.pendingABIRequests.get(normalizedAddress);
    if (pendingRequest) {
      return pendingRequest;
    }

    // Create and track the request
    const requestPromise = this.fetchABIFromInternalAPI(normalizedAddress);
    this.pendingABIRequests.set(normalizedAddress, requestPromise);

    try {
      const abi = await requestPromise;

      if (abi) {
        // Cache successful result
        this.abiCache.set(normalizedAddress, {
          abi,
          timestamp: Date.now(),
        });

        // Also cache in localStorage for persistence
        this.saveABIToLocalStorage(normalizedAddress, abi);
      }

      return abi;
    } catch (error) {
      // Try to get from localStorage as last resort
      const localStorageABI = this.getABIFromLocalStorage(normalizedAddress);
      if (localStorageABI) {
        return localStorageABI;
      }

      Sentry.withScope((scope) => {
        scope.setTag("component", "contract-api-service");
        scope.setContext("address", { address: normalizedAddress });
        Sentry.captureException(error);
      });

      console.error(`Failed to fetch ABI for ${normalizedAddress}:`, error);
      return null;
    } finally {
      // Clean up pending request
      this.pendingABIRequests.delete(normalizedAddress);
    }
  }

  /**
   * Get contract information with caching and fallback
   */
  async getContractInfo(address: string): Promise<ContractInfo | null> {
    const normalizedAddress = normalizeAddress(address);

    // Check cache first
    const cached = this.contractInfoCache.get(normalizedAddress);
    if (cached && Date.now() - cached.timestamp < this.INFO_CACHE_DURATION) {
      return cached.info;
    }

    // Check if there's already a pending request for this address
    const pendingRequest = this.pendingInfoRequests.get(normalizedAddress);
    if (pendingRequest) {
      return pendingRequest;
    }

    // Create and track the request
    const requestPromise =
      this.fetchContractInfoFromInternalAPI(normalizedAddress);
    this.pendingInfoRequests.set(normalizedAddress, requestPromise);

    try {
      let info = await requestPromise;

      // If we got contract source but no token info, try to get token details
      if (info && !info.symbol) {
        const tokenInfo = await this.fetchTokenInfo();
        if (tokenInfo) {
          info = { ...info, ...tokenInfo };
        }
      }

      if (info) {
        // Cache successful result
        this.contractInfoCache.set(normalizedAddress, {
          info,
          timestamp: Date.now(),
        });

        // Also cache in localStorage for persistence
        this.saveContractInfoToLocalStorage(normalizedAddress, info);
      }

      return info;
    } catch (error) {
      // Try to get from localStorage as last resort
      const localStorageInfo =
        this.getContractInfoFromLocalStorage(normalizedAddress);
      if (localStorageInfo) {
        return localStorageInfo;
      }

      Sentry.withScope((scope) => {
        scope.setTag("component", "contract-api-service");
        scope.setContext("address", { address: normalizedAddress });
        Sentry.captureException(error);
      });

      console.error(
        `Failed to fetch contract info for ${normalizedAddress}:`,
        error,
      );
      return null;
    } finally {
      // Clean up pending request
      this.pendingInfoRequests.delete(normalizedAddress);
    }
  }

  /**
   * Fetch ABI from internal API (avoiding CORS issues)
   */
  private async fetchABIFromInternalAPI(
    address: string,
  ): Promise<unknown[] | null> {
    try {
      const response = await fetch(
        `${this.INTERNAL_ABI_API}?address=${address}`,
        {
          headers: {
            Accept: "application/json",
          },
        },
      );

      if (!response.ok) {
        if (response.status === 404) {
          // Contract not found or not verified
          return null;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.abi && Array.isArray(data.abi)) {
        return data.abi;
      }

      return null;
    } catch (error) {
      console.warn(`Internal ABI API failed for ${address}:`, error);
      return null;
    }
  }

  /**
   * Fetch contract info from internal API (avoiding CORS issues)
   */
  private async fetchContractInfoFromInternalAPI(
    address: string,
  ): Promise<ContractInfo | null> {
    try {
      const response = await fetch(
        `${this.INTERNAL_INFO_API}?address=${address}`,
        {
          headers: {
            Accept: "application/json",
          },
        },
      );

      if (!response.ok) {
        if (response.status === 404) {
          // Contract not found or not verified
          return null;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.name) {
        return {
          name: data.name,
        };
      }

      return null;
    } catch (error) {
      console.warn(`Internal contract info API failed for ${address}:`, error);
      return null;
    }
  }

  /**
   * Try to fetch token information (symbol, decimals) by calling contract methods
   */
  private async fetchTokenInfo(): Promise<Partial<ContractInfo> | null> {
    // This would require making actual contract calls
    // For now, we'll implement this in a future iteration
    // We can use the existing ABI to determine if it's a token and call the methods
    return null;
  }

  /**
   * Save ABI to localStorage for persistence
   */
  private saveABIToLocalStorage(address: string, abi: unknown[]): void {
    try {
      const key = `contract_abi_${address}`;
      const data = {
        abi,
        timestamp: Date.now(),
      };
      localStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
      // localStorage might be full or unavailable, ignore silently
      console.warn(`Failed to save ABI to localStorage for ${address}:`, error);
    }
  }

  /**
   * Get ABI from localStorage
   */
  private getABIFromLocalStorage(address: string): unknown[] | null {
    try {
      const key = `contract_abi_${address}`;
      const data = localStorage.getItem(key);

      if (data) {
        const parsed = JSON.parse(data);

        // Check if cache is still valid (24 hours for localStorage cache)
        if (Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
          return parsed.abi;
        }
      }

      return null;
    } catch (error) {
      console.warn(
        `Failed to get ABI from localStorage for ${address}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Save contract info to localStorage for persistence
   */
  private saveContractInfoToLocalStorage(
    address: string,
    info: ContractInfo,
  ): void {
    try {
      const key = `contract_info_${address}`;
      const data = {
        info,
        timestamp: Date.now(),
      };
      localStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
      // localStorage might be full or unavailable, ignore silently
      console.warn(
        `Failed to save contract info to localStorage for ${address}:`,
        error,
      );
    }
  }

  /**
   * Get contract info from localStorage
   */
  private getContractInfoFromLocalStorage(
    address: string,
  ): ContractInfo | null {
    try {
      const key = `contract_info_${address}`;
      const data = localStorage.getItem(key);

      if (data) {
        const parsed = JSON.parse(data);

        // Check if cache is still valid (24 hours for localStorage cache)
        if (Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
          return parsed.info;
        }
      }

      return null;
    } catch (error) {
      console.warn(
        `Failed to get contract info from localStorage for ${address}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Clear all caches (useful for development/debugging)
   */
  clearCaches(): void {
    this.abiCache.clear();
    this.contractInfoCache.clear();

    // Clear localStorage caches
    try {
      const keys = Object.keys(localStorage);
      keys.forEach((key) => {
        if (
          key.startsWith("contract_abi_") ||
          key.startsWith("contract_info_")
        ) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.warn("Failed to clear localStorage caches:", error);
    }
  }
}
