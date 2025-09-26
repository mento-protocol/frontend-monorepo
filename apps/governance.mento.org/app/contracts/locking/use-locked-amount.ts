import { LockingABI } from "@repo/web3";
import { useContracts } from "@/contracts/use-contracts";
import { useEnsureChainId } from "@/governance/use-ensure-chain-id";
import { useAccount, useReadContract } from "wagmi";

export const useLockedAmount = () => {
  const {
    Locking: { address: veTokenAddress },
  } = useContracts();
  const ensuredChainId = useEnsureChainId();

  const { address } = useAccount();

  return useReadContract({
    address: veTokenAddress,
    abi: LockingABI,
    functionName: "locked",
    args: address && [address],
    chainId: ensuredChainId,
  });
};
