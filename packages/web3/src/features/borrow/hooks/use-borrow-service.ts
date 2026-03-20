import { useMemo } from "react";
import { useChainId, usePublicClient } from "wagmi";
import type { BorrowService } from "@mento-protocol/mento-sdk";
import { getBorrowService } from "../sdk";

export function useBorrowService(): BorrowService | null {
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId });

  return useMemo(() => {
    if (!publicClient) return null;
    return getBorrowService(publicClient, chainId);
  }, [publicClient, chainId]);
}
