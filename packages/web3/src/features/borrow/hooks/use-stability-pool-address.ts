import { useQuery } from "@tanstack/react-query";
import {
  getBorrowRegistry,
  resolveAddressesFromRegistry,
} from "@mento-protocol/mento-sdk";
import { useChainId, usePublicClient } from "wagmi";

/**
 * Internal hook to resolve the StabilityPool contract address via SDK address registry.
 * Cached with staleTime: Infinity since contract addresses are immutable.
 *
 * @param symbol - Debt token symbol (default: "GBPm")
 * @param targetChainId - Optional chain ID override. When provided, reads from
 *   this chain regardless of the user's connected chain.
 */
export function useStabilityPoolAddress(
  symbol = "GBPm",
  targetChainId?: number,
  options?: { enabled?: boolean },
) {
  const walletChainId = useChainId();
  const chainId = targetChainId ?? walletChainId;
  const publicClient = usePublicClient({ chainId });

  return useQuery({
    queryKey: ["borrow", "stabilityPoolAddress", symbol, chainId],
    queryFn: async () => {
      const registryAddress = getBorrowRegistry(chainId, symbol);
      const addresses = await resolveAddressesFromRegistry(
        publicClient!,
        registryAddress,
      );
      return addresses.stabilityPool as `0x${string}`;
    },
    enabled: (options?.enabled ?? true) && !!publicClient,
    staleTime: Infinity,
  });
}
