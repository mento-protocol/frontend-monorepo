import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChainId } from "@/config/chains";
import type { PoolRewardInfo } from "../types";

const MERKL_API_BASE = "https://api.merkl.xyz/v4";
const MERKL_PROTOCOL_ID = "mento";
const REWARDS_STALE_TIME = 5 * 60_000; // 5 minutes

interface MerklOpportunity {
  explorerAddress?: string;
  status: string;
  action: string;
  apr: number;
  dailyRewards: number;
  latestCampaignEnd: number | string;
  liveCampaigns: number;
  protocol?: {
    id?: string;
  };
}

export function getPoolRewardKey(
  chainId: ChainId,
  poolAddress: string,
): string {
  return `${chainId}:${poolAddress.toLowerCase()}`;
}

async function fetchChainRewards(
  chainId: ChainId,
): Promise<Map<string, PoolRewardInfo>> {
  const params = new URLSearchParams({
    chainId: String(chainId),
    mainProtocolId: MERKL_PROTOCOL_ID,
  });
  const res = await fetch(`${MERKL_API_BASE}/opportunities?${params}`);
  if (!res.ok) {
    throw new Error(`Merkl API error: ${res.status}`);
  }

  const opportunities: MerklOpportunity[] = await res.json();
  const rewardsMap = new Map<string, PoolRewardInfo>();

  for (const opp of opportunities) {
    if (opp.status !== "LIVE" || opp.action !== "POOL") continue;
    if (opp.protocol?.id && opp.protocol.id !== MERKL_PROTOCOL_ID) continue;
    if (!opp.explorerAddress) continue;

    const campaignEnd = Number(opp.latestCampaignEnd);
    if (!Number.isFinite(campaignEnd)) continue;

    const key = getPoolRewardKey(chainId, opp.explorerAddress);
    rewardsMap.set(key, {
      apr: opp.apr,
      dailyRewards: opp.dailyRewards,
      campaignEnd,
      liveCampaigns: opp.liveCampaigns,
    });
  }

  return rewardsMap;
}

/**
 * Fetches active Merkl reward campaigns for all mainnet chains.
 * Returns a Map keyed by chain-aware pool reward key → reward info.
 */
export function usePoolRewards() {
  const celoQuery = useQuery({
    queryKey: ["pool-rewards", ChainId.Celo, MERKL_PROTOCOL_ID],
    queryFn: () => fetchChainRewards(ChainId.Celo),
    staleTime: REWARDS_STALE_TIME,
    gcTime: 10 * 60_000,
  });

  const monadQuery = useQuery({
    queryKey: ["pool-rewards", ChainId.Monad, MERKL_PROTOCOL_ID],
    queryFn: () => fetchChainRewards(ChainId.Monad),
    staleTime: REWARDS_STALE_TIME,
    gcTime: 10 * 60_000,
  });

  const rewardQueries = [
    { chainId: ChainId.Celo, query: celoQuery },
    { chainId: ChainId.Monad, query: monadQuery },
  ];

  const isLoading = rewardQueries.some(({ query }) => query.isLoading);
  const isError = rewardQueries.some(({ query }) => query.isError);
  const isPartialError =
    isError && rewardQueries.some(({ query }) => query.isSuccess);
  const failedChainIds = rewardQueries
    .filter(({ query }) => query.isError)
    .map(({ chainId }) => chainId);

  const rewards = useMemo(() => {
    const merged = new Map<string, PoolRewardInfo>();
    if (celoQuery.data) {
      for (const [k, v] of celoQuery.data) merged.set(k, v);
    }
    if (monadQuery.data) {
      for (const [k, v] of monadQuery.data) merged.set(k, v);
    }
    return merged;
  }, [celoQuery.data, monadQuery.data]);

  const refetch = async () => {
    await Promise.all(rewardQueries.map(({ query }) => query.refetch()));
  };

  return {
    rewards,
    isLoading,
    isError,
    isPartialError,
    failedChainIds,
    refetch,
  };
}
