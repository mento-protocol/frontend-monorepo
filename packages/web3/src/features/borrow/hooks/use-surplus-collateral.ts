import { useQuery } from "@tanstack/react-query";
import { getBorrowRegistry } from "@mento-protocol/mento-sdk";
import { resolveAddressesFromRegistry } from "@mento-protocol/mento-sdk/dist/services/borrow/borrowHelpers";
import { useAccount, useChainId, usePublicClient } from "wagmi";
import type { Address } from "viem";

const COLL_SURPLUS_POOL_ABI = [
  {
    inputs: [{ name: "_account", type: "address" }],
    name: "getCollateral",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

/**
 * Reads the user's claimable surplus collateral from the CollSurplusPool contract.
 * Returns a bigint amount (18-decimal) or 0n if none is claimable.
 */
export function useSurplusCollateral(symbol = "GBPm") {
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId });
  const { address } = useAccount();

  return useQuery<bigint>({
    queryKey: [
      "borrow",
      "surplusCollateral",
      symbol,
      chainId,
      address?.toString(),
    ],
    queryFn: async () => {
      const registryAddress = getBorrowRegistry(chainId, symbol);
      const addresses = await resolveAddressesFromRegistry(
        publicClient!,
        registryAddress,
      );
      const collSurplusPool = addresses.collSurplusPool as Address;

      const balance = await publicClient!.readContract({
        address: collSurplusPool,
        abi: COLL_SURPLUS_POOL_ABI,
        functionName: "getCollateral",
        args: [address!],
      });

      return balance;
    },
    enabled: !!publicClient && !!address,
    refetchInterval: 30_000,
  });
}
