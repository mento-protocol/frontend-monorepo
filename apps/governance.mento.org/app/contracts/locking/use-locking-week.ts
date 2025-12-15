import { LockingABI } from "@repo/web3";
import { useContracts, useEnsureChainId } from "@repo/web3";
import { useReadContract } from "@repo/web3/wagmi";

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
