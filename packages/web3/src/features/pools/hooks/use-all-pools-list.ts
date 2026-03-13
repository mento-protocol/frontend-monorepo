import { ChainId } from "@/config/chains";
import { IS_DEBUG } from "@/utils/environment";
import { usePoolsList } from "./use-pools-list";
import { sortPoolsByTvl, type PoolDisplay } from "../types";

/** Mainnet chains to fetch pools from */
export const MAINNET_CHAINS: ChainId[] = [ChainId.Celo, ChainId.Monad];

/** Testnet chains (only visible when debug mode is enabled) */
export const TESTNET_CHAINS: ChainId[] = [
  ChainId.CeloSepolia,
  ChainId.MonadTestnet,
];

/** Chains visible in the pools list (mainnet + testnets when debug is on) */
export const VISIBLE_CHAINS: ChainId[] = IS_DEBUG
  ? [...MAINNET_CHAINS, ...TESTNET_CHAINS]
  : MAINNET_CHAINS;

/**
 * Fetches pools from all visible chains in parallel and merges them
 * into a single flat list. Each pool includes its chainId.
 */
export function useAllPoolsList() {
  const celoQuery = usePoolsList(ChainId.Celo);
  const monadQuery = usePoolsList(ChainId.Monad);
  const celoSepoliaQuery = usePoolsList(ChainId.CeloSepolia, {
    enabled: IS_DEBUG,
  });
  const monadTestnetQuery = usePoolsList(ChainId.MonadTestnet, {
    enabled: IS_DEBUG,
  });

  const allQueries = IS_DEBUG
    ? [celoQuery, monadQuery, celoSepoliaQuery, monadTestnetQuery]
    : [celoQuery, monadQuery];

  const isLoading = allQueries.some((q) => q.isLoading);
  const isError = allQueries.every((q) => q.isError);

  const data: PoolDisplay[] = sortPoolsByTvl(
    allQueries.flatMap((q) => q.data ?? []),
  );

  const refetch = async () => {
    await Promise.all(allQueries.map((q) => q.refetch()));
  };

  return { data, isLoading, isError, refetch };
}
