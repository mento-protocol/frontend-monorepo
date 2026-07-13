import { getSubgraphApiName } from "@/config";
import { GovernorABI } from "@repo/web3";
import {
  STATE_FROM_NUMBER,
  isStateNumber,
} from "@/contracts/governor/hook-helpers";
import { useContracts, useEnsureChainId } from "@repo/web3";
import {
  Proposal,
  useGetProposalsQuery,
} from "@/graphql/subgraph/generated/subgraph";
import { reportSubgraphError } from "@/utils/report-subgraph-error";

import { useCallback, useEffect, useMemo } from "react";
import { useReadContracts } from "@repo/web3/wagmi";

export const useProposals = () => {
  const ensuredChainId = useEnsureChainId();
  const contracts = useContracts();

  const {
    data: graphData,
    error,
    refetch,
    loading,
  } = useGetProposalsQuery({
    context: {
      apiName: getSubgraphApiName(ensuredChainId),
    },
    initialFetchPolicy: "network-only",
    nextFetchPolicy: "cache-and-network",
    refetchWritePolicy: "merge",
    errorPolicy: "all",
    pollInterval: 60_000,
  });

  const { data: chainData, isLoading } = useReadContracts({
    contracts: graphData
      ? (graphData?.proposals as Proposal[]).map(
          (proposal: Proposal) =>
            ({
              address: contracts.MentoGovernor.address,
              abi: GovernorABI,
              functionName: "state",
              args: [proposal.proposalId],
              chainId: ensuredChainId,
            }) as const,
        )
      : [],
    query: {
      refetchInterval: 60_000,
      refetchOnWindowFocus: true,
      enabled: graphData && graphData.proposals.length > 0,
    },
  });

  useEffect(() => {
    if (!error) {
      return;
    }

    reportSubgraphError(error, "GetProposals");
  }, [error]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refetch();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refetch]);

  const proposals: Proposal[] = useMemo<Proposal[]>(() => {
    if (chainData === undefined) return [];
    if (graphData?.proposals === undefined) return [];
    const proposalBuild: Proposal[] = [];
    for (const chainDataKey of chainData.keys()) {
      const proposal = graphData.proposals[chainDataKey];
      const chainDataValue = chainData[chainDataKey];
      if (
        !chainDataValue ||
        chainDataValue.status !== "success" ||
        !isStateNumber(chainDataValue.result)
      ) {
        proposalBuild.push(proposal as Proposal);
        continue;
      }

      proposalBuild.push({
        ...(proposal as Proposal),
        state: STATE_FROM_NUMBER[chainDataValue.result],
      });
    }

    return proposalBuild;
  }, [chainData, graphData?.proposals]);

  const proposalExists = useCallback(
    (id: string) => {
      return (
        proposals.filter((proposal) => proposal.proposalId === id).length === 1
      );
    },
    [proposals],
  );

  return {
    error,
    isLoading: isLoading || loading,
    proposals,
    proposalExists,
    refetchProposals: refetch,
  };
};
