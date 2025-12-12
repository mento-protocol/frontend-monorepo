import { LockingABI, useContracts } from "@repo/web3";
import { useAccount, useReadContract } from "@repo/web3/wagmi";

export const useUnlockedMento = () => {
  const contracts = useContracts();
  const { address } = useAccount();

  return useReadContract({
    address: contracts.Locking.address,
    abi: LockingABI,
    functionName: "getAvailableForWithdraw",
    args: address && [address],
    query: {
      enabled: Boolean(address),
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
      refetchInterval: 12000, // Refetch every 12 seconds (typical block time)
    },
  });
};
