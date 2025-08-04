import { LockingABI } from "@/abi/Locking";
import { useContracts } from "@/contracts/use-contracts";
import { useEnsureChainId } from "@/features/governance/use-ensure-chain-id";
import { useAccount, useReadContract } from "@repo/web3/wagmi";

export type TokenBalance = {
  decimals: number;
  value: bigint;
  symbol: string;
  formatted: string;
};

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

export default useLockedAmount;
