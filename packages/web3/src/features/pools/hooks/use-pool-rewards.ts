import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChainId } from "@/config/chains";
import type { PoolRewardInfo } from "../types";
import { MAINNET_CHAINS } from "./use-all-pools-list";

const MERKL_API_BASE = "https://api.merkl.xyz/v4";
const REWARDS_STALE_TIME = 5 * 60_000; // 5 minutes

interface MerklOpportunity {
  identifier: string;
  status: string;
  action: string;
  apr: number;
  dailyRewards: number;
  latestCampaignEnd: number;
  liveCampaigns: number;
}

async function fetchChainRewards(
  chainId: ChainId,
): Promise<Map<string, PoolRewardInfo>> {
  const res = await fetch(`${MERKL_API_BASE}/opportunities?chainId=${chainId}`);
  if (!res.ok) {
    throw new Error(`Merkl API error: ${res.status}`);
  }

  const opportunities: MerklOpportunity[] = await res.json();
  const rewardsMap = new Map<string, PoolRewardInfo>();

  for (const opp of opportunities) {
    if (opp.status !== "LIVE" || opp.action !== "POOL") continue;

    const key = opp.identifier.toLowerCase();
    rewardsMap.set(key, {
      apr: opp.apr,
      dailyRewards: opp.dailyRewards,
      campaignEnd: opp.latestCampaignEnd,
      liveCampaigns: opp.liveCampaigns,
    });
  }

  return rewardsMap;
}

/**
 * Fetches active Merkl reward campaigns for all mainnet chains.
 * Returns a Map keyed by lowercase pool address → reward info.
 */
export function usePoolRewards() {
  const celoQuery = useQuery({
    queryKey: ["pool-rewards", ChainId.Celo],
    queryFn: () => fetchChainRewards(ChainId.Celo),
    staleTime: REWARDS_STALE_TIME,
    gcTime: 10 * 60_000,
  });

  const monadQuery = useQuery({
    queryKey: ["pool-rewards", ChainId.Monad],
    queryFn: () => fetchChainRewards(ChainId.Monad),
    staleTime: REWARDS_STALE_TIME,
    gcTime: 10 * 60_000,
  });

  const isLoading = celoQuery.isLoading || monadQuery.isLoading;

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

  return { rewards, isLoading };
}
