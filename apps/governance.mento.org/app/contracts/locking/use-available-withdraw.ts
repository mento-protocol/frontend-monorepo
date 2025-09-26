import { useContracts } from "@/contracts/use-contracts";
import { useAccount, useReadContract } from "wagmi";
import { LockingABI } from "@repo/web3";
import { useEnsureChainId } from "@/governance/use-ensure-chain-id";

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
