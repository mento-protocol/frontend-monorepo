import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { ChainId } from "@/config/chains";
import { useVisibleChains } from "@/config/testnet-mode";
import type { PoolRewardInfo } from "../types";

const MERKL_API_BASE = "/api/merkl";
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

function mergeRewardInfo(
  existing: PoolRewardInfo | undefined,
  incoming: PoolRewardInfo,
): PoolRewardInfo {
  if (!existing) return incoming;

  return {
    // Multiple live opportunities on the same pool contribute to the
    // total rewards surface shown in the UI.
    apr: existing.apr + incoming.apr,
    dailyRewards: existing.dailyRewards + incoming.dailyRewards,
    campaignEnd: Math.max(existing.campaignEnd, incoming.campaignEnd),
    liveCampaigns: existing.liveCampaigns + incoming.liveCampaigns,
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

    const apr = Number(opp.apr);
    const dailyRewards = Number(opp.dailyRewards);
    const campaignEnd = Number(opp.latestCampaignEnd);
    const liveCampaigns = Number(opp.liveCampaigns);
    if (
      !Number.isFinite(apr) ||
      !Number.isFinite(dailyRewards) ||
      !Number.isFinite(campaignEnd) ||
      !Number.isFinite(liveCampaigns)
    ) {
      continue;
    }

    if (apr <= 0) continue;

    const key = getPoolRewardKey(chainId, opp.explorerAddress);
    rewardsMap.set(
      key,
      mergeRewardInfo(rewardsMap.get(key), {
        apr,
        dailyRewards,
        campaignEnd,
        liveCampaigns,
      }),
    );
  }

  return rewardsMap;
}

/**
 * Fetches active Merkl reward campaigns for all mainnet chains.
 * Returns a Map keyed by chain-aware pool reward key → reward info.
 */
export function usePoolRewards() {
  const rewardChainIds = useVisibleChains("rewards");
  const queries = useQueries({
    queries: rewardChainIds.map((chainId) => ({
      queryKey: ["pool-rewards", chainId, MERKL_PROTOCOL_ID],
      queryFn: () => fetchChainRewards(chainId),
      staleTime: REWARDS_STALE_TIME,
      gcTime: 10 * 60_000,
    })),
  });

  const rewardQueries = rewardChainIds.map((chainId, index) => ({
    chainId,
    query: queries[index]!,
  }));

  const isLoading = rewardQueries.some(({ query }) => query.isLoading);
  const isError = rewardQueries.some(({ query }) => query.isError);
  const isPartialError =
    isError && rewardQueries.some(({ query }) => query.isSuccess);
  const failedChainIds = rewardQueries
    .filter(({ query }) => query.isError)
    .map(({ chainId }) => chainId);

  const rewards = useMemo(() => {
    const merged = new Map<string, PoolRewardInfo>();
    for (const query of queries) {
      if (!query.data) continue;
      for (const [k, v] of query.data) {
        merged.set(k, v);
      }
    }
    return merged;
  }, [queries]);

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
