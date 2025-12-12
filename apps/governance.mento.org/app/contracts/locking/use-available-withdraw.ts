import { useAccount, useReadContract } from "@repo/web3/wagmi";
import { LockingABI, useContracts, useEnsureChainId } from "@repo/web3";

export const useAvailableToWithdraw = () => {
  const { Locking } = useContracts();
  const ensuredChainId = useEnsureChainId();
  const { address } = useAccount();

  const { data: availableToWithdraw = BigInt(0), refetch } = useReadContract({
    address: Locking.address,
    abi: LockingABI,
    functionName: "getAvailableForWithdraw",
    args: address ? [address] : undefined,
    chainId: ensuredChainId,
    query: {
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
      refetchInterval: 12000, // Refetch every 12 seconds (typical block time)
      enabled: !!address,
    },
  });

  return {
    availableToWithdraw,
    refetchAvailableToWithdraw: refetch,
  };
};
