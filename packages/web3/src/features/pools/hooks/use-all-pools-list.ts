import { useMemo } from "react";
import { ChainId } from "@/config/chains";
import { usePoolsList } from "./use-pools-list";
import type { PoolDisplay } from "../types";

/** Mainnet chains to fetch pools from */
export const MAINNET_CHAINS: ChainId[] = [ChainId.Celo, ChainId.Monad];

/**
 * Fetches pools from all mainnet chains in parallel and merges them
 * into a single flat list. Each pool includes its chainId.
 */
export function useAllPoolsList() {
  const celoQuery = usePoolsList(ChainId.Celo);
  const monadQuery = usePoolsList(ChainId.Monad);

  const isLoading = celoQuery.isLoading || monadQuery.isLoading;
  const isError = celoQuery.isError && monadQuery.isError;

  const data = useMemo<PoolDisplay[]>(() => {
    return [...(celoQuery.data ?? []), ...(monadQuery.data ?? [])];
  }, [celoQuery.data, monadQuery.data]);

  const refetch = async () => {
    await Promise.all([celoQuery.refetch(), monadQuery.refetch()]);
  };

  return { data, isLoading, isError, refetch };
}
