import { getSubgraphApiName } from "@/config";
import {
  Lock,
  useGetAllLocksQuery,
} from "@/graphql/subgraph/generated/subgraph";
import { useEnsureChainId } from "@repo/web3";

export const useAllLocks = () => {
  const ensuredChainId = useEnsureChainId();
  const { data, loading } = useGetAllLocksQuery({
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
