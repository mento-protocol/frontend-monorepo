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
    ? [
        { chainId: ChainId.Celo, query: celoQuery },
        { chainId: ChainId.Monad, query: monadQuery },
        { chainId: ChainId.CeloSepolia, query: celoSepoliaQuery },
        { chainId: ChainId.MonadTestnet, query: monadTestnetQuery },
      ]
    : [
        { chainId: ChainId.Celo, query: celoQuery },
        { chainId: ChainId.Monad, query: monadQuery },
      ];

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
