import { useReadContract } from "wagmi";
import { stabilityPoolAbi } from "../stability-pool/abi";
import { useStabilityPoolAddress } from "./use-stability-pool-address";

export function useStabilityPoolStats(symbol = "GBPm", targetChainId?: number) {
  const { data: spAddress } = useStabilityPoolAddress(symbol, targetChainId);

  return useReadContract({
    address: spAddress,
    abi: stabilityPoolAbi,
    functionName: "getTotalBoldDeposits",
    chainId: targetChainId,
    query: {
      enabled: !!spAddress,
      refetchInterval: 30_000,
    },
  });
}
