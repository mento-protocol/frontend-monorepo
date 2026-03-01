import { useAccount, useReadContracts } from "wagmi";
import { stabilityPoolAbi } from "../stability-pool/abi";
import type { StabilityPoolPosition } from "../types";
import { useStabilityPoolAddress } from "./use-stability-pool-address";

export function useStabilityPool(symbol = "GBPm") {
  const { address: account } = useAccount();
  const { data: spAddress } = useStabilityPoolAddress(symbol);

  const result = useReadContracts({
    allowFailure: false,
    contracts: [
      {
        address: spAddress,
        abi: stabilityPoolAbi,
        functionName: "getCompoundedBoldDeposit",
        args: [account!],
      },
      {
        address: spAddress,
        abi: stabilityPoolAbi,
        functionName: "getDepositorCollGain",
        args: [account!],
      },
      {
        address: spAddress,
        abi: stabilityPoolAbi,
        functionName: "getDepositorYieldGain",
        args: [account!],
      },
    ],
    query: {
      enabled: !!spAddress && !!account,
      refetchInterval: 30_000,
    },
  });

  const data: StabilityPoolPosition | undefined = result.data
    ? {
        deposit: result.data[0],
        collateralGain: result.data[1],
        debtTokenGain: result.data[2],
      }
    : undefined;

  return {
    data,
    isLoading: result.isLoading,
    error: result.error,
  };
}
