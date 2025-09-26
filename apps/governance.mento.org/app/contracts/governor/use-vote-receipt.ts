import { useReadContract } from "wagmi";
import { Address } from "viem";
import { GovernorABI } from "@repo/web3";
import { useContracts, useEnsureChainId } from "@repo/web3";

export const useVoteReceipt = ({
  address,
  proposalId,
}: {
  address: Address | undefined;
  proposalId: bigint;
}) => {
  const contracts = useContracts();
  const ensuredChainId = useEnsureChainId();

  return useReadContract({
    abi: GovernorABI,
    address: contracts.MentoGovernor.address,
    functionName: "getReceipt",
    args: [proposalId, address!],
    query: { enabled: !!address },
    chainId: ensuredChainId,
  });
};
