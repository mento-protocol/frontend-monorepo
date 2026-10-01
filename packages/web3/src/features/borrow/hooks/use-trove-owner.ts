import { useQuery } from "@tanstack/react-query";
import {
  getBorrowRegistry,
  resolveAddressesFromRegistry,
} from "@mento-protocol/mento-sdk";
import type { Address, PublicClient } from "viem";
import { useChainId, usePublicClient } from "wagmi";
import { TROVE_NFT_ABI } from "./trove-parsing";

/**
 * Reads the on-chain owner of a trove from its TroveNFT. `ownerOf` reverts for
 * an id with no NFT (a closed or never-opened trove), so callers must treat a
 * rejection as "no owner".
 */
export async function fetchTroveOwner(
  publicClient: PublicClient,
  chainId: number,
  symbol: string,
  troveId: bigint,
): Promise<Address> {
  const registryAddress = getBorrowRegistry(chainId, symbol);
  const addresses = await resolveAddressesFromRegistry(
    publicClient,
    registryAddress,
  );
  const troveNft = addresses.troveNFT as Address;

  return (await publicClient.readContract({
    address: troveNft,
    abi: TROVE_NFT_ABI,
    functionName: "ownerOf",
    args: [troveId],
  })) as Address;
}

/** True only when both addresses are set and equal, ignoring case. */
export function isTroveOwner(owner?: string, account?: string): boolean {
  if (!owner || !account) return false;
  return owner.toLowerCase() === account.toLowerCase();
}

export function useTroveOwner(troveId: string | undefined, symbol = "GBPm") {
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId });

  return useQuery<Address>({
    queryKey: ["borrow", "troveOwner", symbol, chainId, troveId],
    queryFn: () =>
      fetchTroveOwner(
        publicClient as PublicClient,
        chainId,
        symbol,
        BigInt(troveId!),
      ),
    enabled: !!publicClient && !!troveId,
    retry: 1,
    refetchInterval: 15_000,
  });
}
