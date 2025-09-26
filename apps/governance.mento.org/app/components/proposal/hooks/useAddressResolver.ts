"use client";

import { useState, useEffect, useMemo } from "react";
import {
  addressResolverService,
  type ResolvedAddress,
} from "../services/address-resolver-service";

/**
 * Hook to resolve a single address with the new address resolver service
 */
export function useResolvedAddress(address: string | null | undefined): {
  resolved: ResolvedAddress | null;
  isLoading: boolean;
  error: Error | null;
} {
  const [resolved, setResolved] = useState<ResolvedAddress | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!address) {
      setResolved(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    // Try sync resolution first (for local registry hits)
    const syncResolved = addressResolverService.resolveFromCache(address);
    if (syncResolved.source === "local") {
      setResolved(syncResolved);
      setIsLoading(false);
      setError(null);
      return;
    }

    // If not in local registry, do async resolution
    setIsLoading(true);
    setError(null);

    addressResolverService
      .resolve(address)
      .then((result) => {
        setResolved(result);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err : new Error(String(err)));
        // Still set a fallback resolved address
        setResolved(syncResolved);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [address]);

  return { resolved, isLoading, error };
}

/**
 * Hook to resolve multiple addresses efficiently
 */
export function useResolvedAddresses(
  addresses: (string | null | undefined)[],
): {
  resolved: ResolvedAddress[];
  isLoading: boolean;
  error: Error | null;
} {
  const [resolved, setResolved] = useState<ResolvedAddress[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Memoize the addresses array to prevent unnecessary re-renders
  const memoizedAddresses = useMemo(() => addresses, [addresses]);

  useEffect(() => {
    if (!memoizedAddresses.length) {
      setResolved([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    addressResolverService
      .resolveMultiple(memoizedAddresses)
      .then((results) => {
        setResolved(results);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err : new Error(String(err)));
        // Fallback to sync resolution for all addresses
        const fallbackResolved = memoizedAddresses.map((addr) =>
          addressResolverService.resolveFromCache(addr),
        );
        setResolved(fallbackResolved);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [memoizedAddresses]);

  return { resolved, isLoading, error };
}

/**
 * Hook to get contract mappings (replacement for useAllContractMappings)
 */
export function useAllResolvedMappings(): Array<{
  name: string;
  address: string;
  friendlyName?: string;
  symbol?: string;
}> {
  return useMemo(() => {
    return addressResolverService.getAllLocalMappings();
  }, []);
}

/**
 * Hook for backward compatibility with the old useContractName
 */
export function useContractName(address: string | null | undefined): string {
  const { resolved } = useResolvedAddress(address);
  return resolved?.name || "Unknown";
}

/**
 * Hook for backward compatibility with the old useAddressName
 */
export function useAddressName(address: string | null | undefined): string {
  const { resolved } = useResolvedAddress(address);
  return resolved?.friendlyName || resolved?.name || "Unknown";
}

/**
 * Hook for rate feed names
 */
export function useRateFeedName(address: string | null | undefined): {
  name: string;
  isLoading: boolean;
  error: Error | null;
} {
  const [name, setName] = useState<string>("Unknown rate feed");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!address) {
      setName("Unknown rate feed");
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    addressResolverService
      .resolveRateFeed(address)
      .then((resolved) => {
        setName(resolved.name);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err : new Error(String(err)));
        setName("Unknown rate feed");
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [address]);

  return { name, isLoading, error };
}
