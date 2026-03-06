import { useQuery } from "@tanstack/react-query";
import {
  getBorrowRegistry,
  resolveAddressesFromRegistry,
} from "@mento-protocol/mento-sdk";
import { useChainId, usePublicClient } from "wagmi";

/**
 * Internal hook to resolve the StabilityPool contract address via SDK address registry.
 * Cached with staleTime: Infinity since contract addresses are immutable.
 */
export function useStabilityPoolAddress(symbol = "GBPm") {
  const chainId = useChainId();
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
    enabled: !!publicClient,
    staleTime: Infinity,
  });
}
