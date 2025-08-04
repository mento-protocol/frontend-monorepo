import { useReadContract } from "@repo/web3/wagmi";
import { Address } from "viem";
import { GovernorABI } from "@/abi/Governor";
import { useContracts } from "@/contracts/use-contracts";
import { useEnsureChainId } from "@/features/governance/use-ensure-chain-id";

const useVoteReceipt = ({
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

export default useVoteReceipt;
