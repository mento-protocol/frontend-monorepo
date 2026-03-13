"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, Star, Droplets, RefreshCw } from "lucide-react";
import { Button, Input, cn } from "@repo/ui";
import {
  useAllPoolsList,
  usePoolRewards,
  chainIdToSlug,
  chainIdToChain,
  ChainId,
  type PoolFilterType,
  type ChainFilterType,
  type PoolDisplay,
  type PoolRewardInfo,
} from "@repo/web3";
import { MAINNET_CHAINS } from "@repo/web3";
import { PoolsTable } from "./pools-table";
import { LiquidityFlowDialog } from "./liquidity-flow-dialog";
import { RewardsCampaignBanner } from "./rewards-campaign-banner";

const filterTabs: { value: PoolFilterType; label: string }[] = [
  { value: "all", label: "All Pools" },
  { value: "fpmm", label: "FPMM" },
  { value: "legacy", label: "Legacy" },
];

const chainFilters: { value: ChainFilterType; label: string }[] = [
  { value: "all", label: "All" },
  ...MAINNET_CHAINS.map((id) => ({
    value: id as ChainFilterType,
    label: chainIdToChain[id]?.name ?? `Chain ${id}`,
  })),
];

export function PoolsView() {
  const { data: pools = [], isLoading, isError, refetch } = useAllPoolsList();
  const { rewards } = usePoolRewards();
  const [filter, setFilter] = useState<PoolFilterType>("all");
  const [chainFilter, setChainFilter] = useState<ChainFilterType>("all");
  const [showRewardsOnly, setShowRewardsOnly] = useState(false);
  const [search, setSearch] = useState("");
  const router = useRouter();

  const handleSelectPool = useCallback(
    (pool: PoolDisplay, mode: "deposit" | "manage") => {
      const slug = chainIdToSlug(pool.chainId);
      const modeParam = mode === "manage" ? "?mode=manage" : "";
      router.push(`/pools/${slug}/${pool.poolAddr}${modeParam}`);
    },
    [router],
  );

  const getPoolHref = useCallback(
    (pool: PoolDisplay) =>
      `/pools/${chainIdToSlug(pool.chainId)}/${pool.poolAddr}`,
    [],
  );

  const filteredPools = useMemo(() => {
    let result = pools;

    // Pool type filter
    if (filter === "fpmm") {
      result = result.filter((p) => p.poolType === "FPMM");
    } else if (filter === "legacy") {
      result = result.filter((p) => p.poolType === "Legacy");
    }

    // Chain filter
    if (chainFilter !== "all") {
      result = result.filter((p) => p.chainId === chainFilter);
    }

    // Rewards filter
    if (showRewardsOnly) {
      result = result.filter((p) => rewards.has(p.poolAddr.toLowerCase()));
    }

    // Search
    if (search.trim()) {
      const query = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.token0.symbol.toLowerCase().includes(query) ||
          p.token1.symbol.toLowerCase().includes(query) ||
          p.token0.name.toLowerCase().includes(query) ||
          p.token1.name.toLowerCase().includes(query) ||
          p.poolAddr.toLowerCase().includes(query),
      );
    }

    return result;
  }, [pools, filter, chainFilter, showRewardsOnly, rewards, search]);

  const hasLegacyPools = useMemo(
    () =>
      (filter === "all" || filter === "legacy") &&
      filteredPools.some((p) => p.poolType === "Legacy"),
    [filteredPools, filter],
  );
  const showPoolsError = isError && pools.length === 0;
  const showNoPools = !isLoading && !isError && pools.length === 0;

  return (
    <>
      <div className="max-w-5xl space-y-4 px-4 pt-6 md:px-0 md:pt-0 flex h-full w-full flex-col overflow-hidden">
        {/* Header */}
        <div className="relative">
          <div className="top-decorations after:-top-15 before:-left-5 before:-top-5 before:h-5 before:w-5 after:left-0 after:h-10 after:w-10 md:block hidden before:absolute before:block before:bg-primary after:absolute after:block after:bg-card"></div>
          <div className="p-6 bg-card">
            <span className="font-mono font-medium tracking-widest text-[11px] text-muted-foreground uppercase">
              Liquidity Provision
            </span>
            <h1 className="mt-2 font-bold text-3xl">Pool</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Explore pools across all chains, view on-chain metrics, and
              provide liquidity.
            </p>
          </div>
        </div>

        {/* Rewards Campaign Banner */}
        {rewards.size > 0 && (
          <RewardsCampaignBanner rewards={rewards} pools={pools} />
        )}

        {!showPoolsError && (isLoading || pools.length > 0) && (
          <div className="gap-4 md:flex-row md:items-center md:justify-between flex flex-col">
            <div className="md:w-auto md:justify-start flex w-full flex-wrap items-center justify-center">
              {/* Pool type filters */}
              {filterTabs.map((tab) => (
                <button
                  key={tab.value}
                  onClick={() => setFilter(tab.value)}
                  className={cn(
                    "px-4 py-2 text-sm font-medium md:flex-none flex-1 cursor-pointer border-0 transition-colors outline-none",
                    filter === tab.value
                      ? "bg-card text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab.label}
                </button>
              ))}

              {/* Divider */}
              <div className="mx-1 h-5 md:block hidden w-px bg-border" />

              {/* Chain filters (toggles) */}
              {chainFilters.map((cf) => (
                <button
                  key={String(cf.value)}
                  onClick={() => setChainFilter(cf.value)}
                  className={cn(
                    "gap-1.5 px-4 py-2 text-sm font-medium inline-flex cursor-pointer items-center border-0 transition-colors outline-none",
                    chainFilter === cf.value
                      ? "bg-card text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {cf.value !== "all" && (
                    <ChainIcon chainId={cf.value as ChainId} />
                  )}
                  {cf.label}
                </button>
              ))}

              {/* Divider */}
              <div className="mx-1 h-5 md:block hidden w-px bg-border" />

              {/* Rewards toggle */}
              <button
                onClick={() => setShowRewardsOnly(!showRewardsOnly)}
                className={cn(
                  "gap-1.5 px-4 py-2 text-sm font-medium inline-flex cursor-pointer items-center border-0 transition-colors outline-none",
                  showRewardsOnly
                    ? "bg-card text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Star className="h-3.5 w-3.5" />
                Rewards
              </button>
            </div>

            <div className="relative">
              <Search className="left-3 h-4 w-4 absolute top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search pools..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 pl-9 md:w-96 w-full"
              />
            </div>
          </div>
        )}

        <div className="min-h-0 space-y-3 flex flex-1 flex-col">
          {showPoolsError ? (
            <PoolsErrorState onRetry={() => void refetch()} />
          ) : showNoPools ? (
            <NoPoolsState />
          ) : (
            <PoolsTable
              pools={filteredPools}
              isLoading={isLoading}
              onSelectPool={handleSelectPool}
              getPoolHref={getPoolHref}
              rewards={rewards}
            />
          )}

          {hasLegacyPools && (
            <div className="relative">
              <div className="px-4 py-3 text-sm bg-card text-muted-foreground">
                Legacy pools are planned for migration to FPMM. Liquidity
                actions are not available for these pools.
              </div>
              <div className="bottom-decorations after:-bottom-15 before:-bottom-5 before:-right-5 before:h-5 before:w-5 after:right-0 after:h-10 after:w-10 md:block hidden before:absolute before:block before:bg-card before:invert after:absolute after:block after:bg-card"></div>
            </div>
          )}
        </div>
      </div>
      <LiquidityFlowDialog />
    </>
  );
}

function ChainIcon({ chainId }: { chainId: ChainId }) {
  const chain = chainIdToChain[chainId];
  const iconUrl = (chain as unknown as Record<string, unknown>)?.iconUrl as
    | string
    | undefined;

  if (!iconUrl) return null;

  return (
    <img
      src={iconUrl}
      alt={chain?.name ?? ""}
      className="h-4 w-4 rounded-full"
    />
  );
}

function PoolsErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="px-6 py-14 relative overflow-hidden rounded-xl border border-border bg-card text-center">
      <div className="top-0 w-48 absolute left-1/2 h-[2px] -translate-x-1/2 bg-gradient-to-r from-transparent via-destructive/50 to-transparent" />

      <div className="mb-7 flex justify-center">
        <div className="h-14 w-14 flex items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <RefreshCw className="h-7 w-7" />
        </div>
      </div>

      <h2 className="mb-2.5 text-xl font-bold tracking-tight">
        Unable to load pools
      </h2>
      <p className="max-w-sm text-sm leading-relaxed mx-auto text-muted-foreground">
        The pools list could not be loaded right now. Try again in a moment.
      </p>

      <Button onClick={onRetry} size="lg" className="mt-8 gap-2.5">
        <RefreshCw className="h-4 w-4" />
        Retry
      </Button>
    </div>
  );
}

function NoPoolsState() {
  return (
    <div className="px-6 py-14 relative overflow-hidden rounded-xl border border-border bg-card text-center">
      <div className="top-0 w-48 absolute left-1/2 h-[2px] -translate-x-1/2 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

      <div className="mb-7 flex justify-center">
        <div className="h-14 w-14 flex items-center justify-center rounded-full bg-primary/10">
          <Droplets className="h-7 w-7 text-primary" />
        </div>
      </div>

      <h2 className="mb-2.5 text-xl font-bold tracking-tight">
        No pools found
      </h2>
      <p className="max-w-sm text-sm leading-relaxed mx-auto text-muted-foreground">
        No pools match your current filters. Try adjusting your search or filter
        criteria.
      </p>
    </div>
  );
}
