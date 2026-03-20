import { useQuery } from "@tanstack/react-query";
import {
  getBorrowRegistry,
  resolveAddressesFromRegistry,
} from "@mento-protocol/mento-sdk";
import type { Address } from "viem";
import { useAccount, useChainId, usePublicClient } from "wagmi";
import type { BorrowPosition } from "../types";
import {
  TROVE_MANAGER_ABI,
  TROVE_NFT_ABI,
  parseBorrowPositionSafe,
  type LatestTroveDataLike,
  type TrovesDataLike,
} from "./trove-parsing";

export function useUserTroves(symbol = "GBPm") {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId });

  return useQuery<BorrowPosition[]>({
    queryKey: ["borrow", "userTroves", symbol, chainId, address],
    queryFn: async () => {
      const owner = address!;
      const ownerLc = owner.toLowerCase();

      const registryAddress = getBorrowRegistry(chainId, symbol);
      const addresses = await resolveAddressesFromRegistry(
        publicClient!,
        registryAddress,
      );

      const troveManager = addresses.troveManager as Address;
      const troveNft = addresses.troveNFT as Address;

      const troveCount = (await publicClient!.readContract({
        address: troveManager,
        abi: TROVE_MANAGER_ABI,
        functionName: "getTroveIdsCount",
      })) as bigint;

      const ownedTroveIds: bigint[] = [];

      for (let i = 0n; i < troveCount; i++) {
        const troveId = (await publicClient!.readContract({
          address: troveManager,
          abi: TROVE_MANAGER_ABI,
          functionName: "getTroveFromTroveIdsArray",
          args: [i],
        })) as bigint;

        const troveOwner = (await publicClient!.readContract({
          address: troveNft,
          abi: TROVE_NFT_ABI,
          functionName: "ownerOf",
          args: [troveId],
        })) as Address;

        if (troveOwner.toLowerCase() === ownerLc) {
          ownedTroveIds.push(troveId);
        }
      }

      return Promise.all(
        ownedTroveIds.map(async (troveId) => {
          const [latestData, trovesData] = await Promise.all([
            publicClient!.readContract({
              address: troveManager,
              abi: TROVE_MANAGER_ABI,
              functionName: "getLatestTroveData",
              args: [troveId],
            }),
            publicClient!.readContract({
              address: troveManager,
              abi: TROVE_MANAGER_ABI,
              functionName: "Troves",
              args: [troveId],
            }),
          ]);

          return parseBorrowPositionSafe(
            troveId,
            latestData as LatestTroveDataLike,
            trovesData as TrovesDataLike,
          );
        }),
      );
    },
    enabled: !!publicClient && !!address,
    refetchInterval: 15_000,
  });
}
