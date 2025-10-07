import {
  LockingABI,
  useContracts,
  useEnsureChainId,
  useTokens,
} from "@repo/web3";
import { Lock } from "@/graphql/subgraph/generated/subgraph";
import { formatUnits, parseUnits } from "viem";
import { useReadContract } from "wagmi";

interface ILockHook {
  lock: Pick<Lock, "slope" | "cliff"> & { amount: string };
}

export const useLockCalculation = ({ lock }: ILockHook) => {
  const { Locking } = useContracts();
  const {
    mentoContractData: { decimals: mentoDecimals },
    veMentoContractData: { decimals: veMentoDecimals },
  } = useTokens();
  const ensuredChainId = useEnsureChainId();

  return useReadContract({
    address: Locking.address,
    abi: LockingABI,
    functionName: "getLock",
    args: [parseUnits(lock.amount, mentoDecimals), lock.slope, lock.cliff],
    chainId: ensuredChainId,
    query: {
      enabled: Number(lock.amount) > 0 && lock.slope > 0,
      select: ([quote, slope]) => {
        return {
          veMentoReceived: Number(formatUnits(quote, veMentoDecimals)).toFixed(
            3,
          ),
          slope: formatUnits(slope, 1),
        };
      },
    },
  });
};
