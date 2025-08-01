import { GovernorABI } from "@/lib/abi/Governor";
import { useContracts } from "@/lib/contracts/useContracts";
import { useEnsureChainId } from "@/lib/hooks/use-ensure-chain-id";
import { useReadContract } from "@repo/web3/wagmi";

// Used for getting the quorum at a specific block
export const useQuorum = (blockNumber: bigint) => {
  const ensuredChainId = useEnsureChainId();
  const { MentoGovernor } = useContracts();

  const { data: quorumNeeded } = useReadContract({
    address: MentoGovernor.address,
    abi: GovernorABI,
    functionName: "quorum",
    args: [blockNumber],
    chainId: ensuredChainId,
  });

  return {
    quorumNeeded,
  };
};
