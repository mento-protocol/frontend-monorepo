import { useReadContract } from "wagmi";
import { stabilityPoolAbi } from "../stability-pool/abi";
import { useStabilityPoolAddress } from "./use-stability-pool-address";

export function useStabilityPoolStats(symbol = "GBPm") {
  const { data: spAddress } = useStabilityPoolAddress(symbol);

  return useReadContract({
    address: spAddress,
    abi: stabilityPoolAbi,
    functionName: "getTotalBoldDeposits",
    query: {
      enabled: !!spAddress,
      refetchInterval: 30_000,
    },
  });
}
