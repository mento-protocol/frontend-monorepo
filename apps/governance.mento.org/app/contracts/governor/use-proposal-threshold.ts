import { GovernorABI } from "@repo/web3";
import { useContracts } from "@/contracts/use-contracts";
import { useEnsureChainId } from "@/governance/use-ensure-chain-id";
import { useReadContract } from "wagmi";

export const useProposalThreshold = () => {
  const ensuredChainId = useEnsureChainId();
  const { MentoGovernor } = useContracts();

  const { data: proposalThreshold, isLoading } = useReadContract({
    address: MentoGovernor.address,
    abi: GovernorABI,
    functionName: "proposalThreshold",
    args: [],
    chainId: ensuredChainId,
  });

  return {
    proposalThreshold: proposalThreshold ?? 0n,
    isLoadingProposalThreshold: isLoading,
  };
};
