import { useQuery } from "@tanstack/react-query";
import { getBorrowRegistry } from "@mento-protocol/mento-sdk";
import { resolveAddressesFromRegistry } from "@mento-protocol/mento-sdk/dist/services/borrow/borrowHelpers";
import type { Address } from "viem";
import { useChainId, usePublicClient } from "wagmi";
import type { BorrowPosition } from "../types";
import {
  TROVE_MANAGER_ABI,
  parseBorrowPositionSafe,
  type LatestTroveDataLike,
  type TrovesDataLike,
} from "./trove-parsing";

export function useTroveData(troveId: string | undefined, symbol = "GBPm") {
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId });

  return useQuery<BorrowPosition>({
    queryKey: ["borrow", "troveData", symbol, chainId, troveId],
    queryFn: async () => {
      const registryAddress = getBorrowRegistry(chainId, symbol);
      const addresses = await resolveAddressesFromRegistry(
        publicClient!,
        registryAddress,
      );
      const troveManager = addresses.troveManager as Address;
      const troveIdBigint = BigInt(troveId!);

      const [latestData, trovesData] = await Promise.all([
        publicClient!.readContract({
          address: troveManager,
          abi: TROVE_MANAGER_ABI,
          functionName: "getLatestTroveData",
          args: [troveIdBigint],
        }),
        publicClient!.readContract({
          address: troveManager,
          abi: TROVE_MANAGER_ABI,
          functionName: "Troves",
          args: [troveIdBigint],
        }),
      ]);

      return parseBorrowPositionSafe(
        troveIdBigint,
        latestData as LatestTroveDataLike,
        trovesData as TrovesDataLike,
      );
    },
    enabled: !!publicClient && !!troveId,
    refetchInterval: 15_000,
  });
}
