import { LockingABI } from "@/abi/Locking";
import { useAccount, useReadContract } from "wagmi";
import { useContracts } from "@/contracts/use-contracts";

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
