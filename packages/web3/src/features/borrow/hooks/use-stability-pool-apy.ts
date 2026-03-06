import { useReadContract, useReadContracts } from "wagmi";
import { parseAbi } from "viem";
import { stabilityPoolAbi } from "../stability-pool/abi";
import { useStabilityPoolAddress } from "./use-stability-pool-address";

const activePoolAbi = parseAbi([
  "function aggWeightedDebtSum() view returns (uint256)",
]);

// SP_YIELD_SPLIT is immutable, set at deployment to 75%.
// Could be read from SystemParams contract if needed for multi-deployment support.
const SP_YIELD_SPLIT = 750_000_000_000_000_000n;
const DECIMAL_PRECISION = 10n ** 18n;

export function useStabilityPoolApy(symbol = "GBPm") {
  const { data: spAddress } = useStabilityPoolAddress(symbol);

  const { data: spData, isLoading: spDataLoading } = useReadContracts({
    allowFailure: false,
    contracts: [
      {
        address: spAddress,
        abi: stabilityPoolAbi,
        functionName: "activePool",
      },
      {
        address: spAddress,
        abi: stabilityPoolAbi,
        functionName: "getTotalBoldDeposits",
      },
    ],
    query: {
      enabled: !!spAddress,
      refetchInterval: 30_000,
    },
  });

  const activePoolAddress = spData?.[0] as `0x${string}` | undefined;
  const totalDeposits = spData?.[1] as bigint | undefined;

  const { data: aggWeightedDebtSum, isLoading: apLoading } = useReadContract({
    address: activePoolAddress,
    abi: activePoolAbi,
    functionName: "aggWeightedDebtSum",
    query: {
      enabled: !!activePoolAddress,
      refetchInterval: 30_000,
    },
  });

  if (!aggWeightedDebtSum || !totalDeposits || totalDeposits === 0n) {
    return { data: null, isLoading: spDataLoading || apLoading };
  }

  // aggWeightedDebtSum = sum(debt_wei * rate_wei), so it has 36 decimals.
  // Divide by 1e18 twice: once for the rate precision, once for the SP_YIELD_SPLIT precision.
  const annualYieldToSP =
    (aggWeightedDebtSum * SP_YIELD_SPLIT) /
    DECIMAL_PRECISION /
    DECIMAL_PRECISION;
  // APY as a fraction (e.g., 0.052 = 5.2%). Multiply by 10000 first to preserve 4 decimal places.
  const apy = Number((annualYieldToSP * 10000n) / totalDeposits) / 10000;

  return { data: apy, isLoading: false };
}
