import { CELO_BLOCK_TIME, getSubgraphApiName } from "@/config";
import { GovernorABI } from "@/abi/Governor";
import {
  STATE_FROM_NUMBER,
  isStateNumber,
} from "@/contracts/governor/hook-helpers";
import { useContracts } from "@/contracts/use-contracts";
import {
  Proposal,
  useGetProposalQuery,
} from "@/graphql/subgraph/generated/subgraph";
import { useEnsureChainId } from "@/features/governance/use-ensure-chain-id";
import { NetworkStatus } from "@apollo/client";
import { useMemo } from "react";
import { useReadContract } from "wagmi";
export const ProposalQueryKey = "proposal";

export const useProposal = (proposalId: bigint) => {
  const contracts = useContracts();
  const ensuredChainId = useEnsureChainId();

  const {
    data: { proposals: graphProposals } = { proposals: [] },
    networkStatus: graphNetworkStatus,
    refetch: refetchProposal,
  } = useGetProposalQuery({
    context: {
      apiName: getSubgraphApiName(ensuredChainId),
    },
    refetchWritePolicy: "merge",
    initialFetchPolicy: "network-only",
    nextFetchPolicy: "cache-and-network",
    variables: {
      id: proposalId.toString(),
    },
  });

  const {
    data: chainData,
    isLoading: isChainDataLoading,
    refetch: refetchChainData,
  } = useReadContract({
    address: contracts.MentoGovernor.address,
    abi: GovernorABI,
    functionName: "state",
    args: [proposalId],
    chainId: ensuredChainId,
    query: {
      refetchInterval: CELO_BLOCK_TIME * 10,
      enabled: graphProposals.length > 0,
    },
  });

  const proposal: Proposal | undefined = useMemo<Proposal | undefined>(() => {
    if (graphProposals === undefined || graphProposals.length === 0) return;
    const graphProposal = graphProposals[0];

    if (chainData === undefined || !isStateNumber(chainData)) {
      return graphProposal as Proposal;
    }

    return {
      ...(graphProposal as Proposal),
      state: STATE_FROM_NUMBER[chainData],
    };
  }, [chainData, graphProposals]);

  const refetch = async () => {
    await refetchProposal();
    await refetchChainData();
  };

  return {
    proposal,
    isLoading:
      graphNetworkStatus === NetworkStatus.loading || isChainDataLoading,
    refetch,
  };
};
