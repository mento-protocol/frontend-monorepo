import { getSubgraphApiName } from "@/config";
import {
  GetAllLocksDocument,
  GetAllLocksQuery,
  GetAllLocksQueryVariables,
  Lock,
} from "@/graphql/subgraph/generated/subgraph";
import { useQuery } from "@apollo/client/react";
import { useEnsureChainId } from "@repo/web3";

export const useAllLocks = () => {
  const ensuredChainId = useEnsureChainId();
  const { data, loading } = useQuery<
    GetAllLocksQuery,
    GetAllLocksQueryVariables
  >(GetAllLocksDocument, {
    // queryKey: "locking-contract-hook",
    refetchWritePolicy: "overwrite",
    context: {
      apiName: getSubgraphApiName(ensuredChainId),
    },
  });

  return {
    locks: data?.locks ?? ([] as Lock[]),
    loading,
  };
};
