import { LockingABI } from "@repo/web3";
import { useContracts, useEnsureChainId } from "@repo/web3";
import { useAccount, useReadContract } from "@repo/web3/wagmi";

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
