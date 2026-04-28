import { useReadContract } from "wagmi";
import { stabilityPoolAbi } from "../stability-pool/abi";
import { useStabilityPoolAddress } from "./use-stability-pool-address";

export function useStabilityPoolStats(
  symbol = "GBPm",
  targetChainId?: number,
  options?: { enabled?: boolean },
) {
  const { data: spAddress } = useStabilityPoolAddress(
    symbol,
    targetChainId,
    options,
  );

  return useReadContract({
    address: spAddress,
    abi: stabilityPoolAbi,
    functionName: "getTotalBoldDeposits",
    chainId: targetChainId,
    query: {
      enabled: (options?.enabled ?? true) && !!spAddress,
      refetchInterval: 30_000,
    },
  });
}
