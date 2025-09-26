import { GovernorABI } from "@repo/web3";
import { useContracts, useEnsureChainId } from "@repo/web3";
import { useReadContract } from "wagmi";

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
