import { useVisibleChains } from "@/config/testnet-mode";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { getPoolsListQueryOptions } from "./use-pools-list";
import { sortPoolsByTvl, type PoolDisplay } from "../types";

/**
 * Fetches pools from all visible chains in parallel and merges them
 * into a single flat list. Each pool includes its chainId.
 */
export function useAllPoolsList() {
  const queryClient = useQueryClient();
  const visibleChains = useVisibleChains("pools");
  const queries = useQueries({
    queries: visibleChains.map((chainId) =>
      getPoolsListQueryOptions(chainId, queryClient),
    ),
  });

  const allQueries = visibleChains.map((chainId, index) => ({
    chainId,
    query: queries[index]!,
  }));

  // Progressive loading: show pools from chains that have resolved while
  // others are still in flight, instead of blocking on the slowest chain.
  const isLoading = allQueries.every(({ query }) => query.isLoading);
  const isFetchingMore = allQueries.some(({ query }) => query.isLoading);
  const isError = allQueries.some(({ query }) => query.isError);
  const isPartialError =
    isError && allQueries.some(({ query }) => query.isSuccess);
  const failedChainIds = allQueries
    .filter(({ query }) => query.isError)
    .map(({ chainId }) => chainId);

  const data: PoolDisplay[] = sortPoolsByTvl(
    allQueries.flatMap(({ query }) => query.data ?? []),
  );

  const refetch = async () => {
    await Promise.all(allQueries.map(({ query }) => query.refetch()));
  };

  return {
    data,
    isLoading,
    isFetchingMore,
    isError,
    isPartialError,
    failedChainIds,
    refetch,
  };
}
