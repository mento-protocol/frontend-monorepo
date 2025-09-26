import { LockingABI } from "@repo/web3";
import { useContracts } from "@/contracts/use-contracts";
import { useEnsureChainId } from "@/governance/use-ensure-chain-id";
import { useReadContract } from "wagmi";

export const useLockingWeek = () => {
  const { Locking } = useContracts();
  const ensuredChainId = useEnsureChainId();

  const {
    data: currentWeek,
    isLoading,
    ...rest
  } = useReadContract({
    address: Locking.address,
    abi: LockingABI,
    functionName: "getWeek",
    scopeKey: "lock-get-week",
    args: [],
    chainId: ensuredChainId,
    query: {
      refetchOnReconnect: true,
      initialData: 0n,
    },
  });

  return {
    isLoading,
    currentWeek,
    ...rest,
  };
};
