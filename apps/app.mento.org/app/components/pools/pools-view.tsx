"use client";

import { useMemo, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Search, Star, Droplets, RefreshCw, AlertTriangle } from "lucide-react";
import { Button, Input, cn } from "@repo/ui";
import {
  useAllPoolsList,
  usePoolRewards,
  getPoolRewardKey,
  chainIdToSlug,
  chainIdToChain,
  ChainId,
  type PoolFilterType,
  type ChainFilterType,
  type PoolDisplay,
} from "@repo/web3";
import { VISIBLE_CHAINS } from "@repo/web3";
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
  ...VISIBLE_CHAINS.map((id) => ({
    value: id as ChainFilterType,
    label: chainIdToChain[id]?.name ?? `Chain ${id}`,
  })),
];

export function PoolsView() {
  const {
    data: pools = [],
    isLoading,
    isFetchingMore,
    isError,
    isPartialError: isPoolsPartialError,
    failedChainIds: failedPoolChainIds,
    refetch,
  } = useAllPoolsList();
  const {
    rewards,
    isLoading: isRewardsLoading,
    isError: isRewardsError,
    failedChainIds: failedRewardChainIds,
    refetch: refetchRewards,
  } = usePoolRewards();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Filter state lives in URL so it persists across refresh / share
  const filter = (searchParams.get("type") as PoolFilterType) || "all";
  const chainParam = searchParams.get("chain");
  const chainFilter: ChainFilterType =
    chainParam && !Number.isNaN(Number(chainParam))
      ? (Number(chainParam) as ChainId)
      : "all";
  const showRewardsOnly = searchParams.get("rewards") === "1";
  const search = searchParams.get("q") ?? "";

  const setFilter = useCallback(
    (value: PoolFilterType) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === "all") params.delete("type");
      else params.set("type", value);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );
  const setChainFilter = useCallback(
    (value: ChainFilterType) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === "all") params.delete("chain");
      else params.set("chain", String(value));
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );
  const setShowRewardsOnly = useCallback(
    (on: boolean) => {
      const params = new URLSearchParams(searchParams.toString());
      if (on) params.set("rewards", "1");
      else params.delete("rewards");
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );
  const setSearch = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set("q", value);
      else params.delete("q");
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

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
  const canApplyRewardsFilter =
    !isRewardsLoading && (!isRewardsError || rewards.size > 0);

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
    if (showRewardsOnly && canApplyRewardsFilter) {
      result = result.filter((p) =>
        rewards.has(getPoolRewardKey(p.chainId, p.poolAddr)),
      );
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
  }, [
    pools,
    filter,
    chainFilter,
    showRewardsOnly,
    rewards,
    search,
    canApplyRewardsFilter,
  ]);

  const hasLegacyPools = useMemo(
    () =>
      (filter === "all" || filter === "legacy") &&
      filteredPools.some((p) => p.poolType === "Legacy"),
    [filteredPools, filter],
  );
  const showPoolsError = isError && pools.length === 0;
  const showNoPools = !isLoading && !isError && pools.length === 0;
  const showPoolsWarning = isPoolsPartialError && pools.length > 0;
  const showRewardsWarning = isRewardsError;

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

        {showPoolsWarning && (
          <InlineWarningCard
            title="Some chain pools could not be loaded"
            description={`Showing the available pools while ${formatChainList(
              failedPoolChainIds,
            )} is unavailable. Retry to refresh the full cross-chain list.`}
            onRetry={() => void refetch()}
          />
        )}

        {showRewardsWarning && (
          <InlineWarningCard
            title="Rewards data is partially unavailable"
            description={`Merkl rewards could not be loaded for ${formatChainList(
              failedRewardChainIds,
            )}. Reward badges, the campaign banner, and the Rewards filter may be incomplete until rewards refresh successfully.`}
            onRetry={() => void refetchRewards()}
          />
        )}

        {!showPoolsError && (isLoading || pools.length > 0) && (
          <div className="gap-4 md:flex-row md:items-center md:justify-between flex flex-col">
            <div className="md:w-auto md:justify-start flex w-full flex-wrap items-center justify-center">
              {/* Pool type filters */}
              {filterTabs.map((tab) => (
                <button
                  type="button"
                  key={tab.value}
                  onClick={() => setFilter(tab.value)}
                  aria-pressed={filter === tab.value}
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
                  type="button"
                  key={String(cf.value)}
                  onClick={() => setChainFilter(cf.value)}
                  aria-pressed={chainFilter === cf.value}
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
                type="button"
                onClick={() => setShowRewardsOnly(!showRewardsOnly)}
                disabled={!canApplyRewardsFilter}
                aria-pressed={showRewardsOnly}
                className={cn(
                  "gap-1.5 px-4 py-2 text-sm font-medium inline-flex cursor-pointer items-center border-0 transition-colors outline-none",
                  showRewardsOnly
                    ? "bg-card text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                  !canApplyRewardsFilter &&
                    "cursor-not-allowed opacity-50 hover:text-muted-foreground",
                )}
                aria-busy={isRewardsLoading}
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
              isFetchingMore={isFetchingMore}
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
    <Image
      src={iconUrl}
      alt={chain?.name ?? ""}
      width={16}
      height={16}
      className="h-4 w-4 rounded-full"
      unoptimized
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

function InlineWarningCard({
  title,
  description,
  onRetry,
}: {
  title: string;
  description: string;
  onRetry: () => void;
}) {
  return (
    <div className="gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between border-amber-500/20 bg-amber-500/8 text-sm flex flex-col border">
      <div className="gap-3 flex items-start">
        <div className="mt-0.5 h-8 w-8 bg-amber-500/12 text-amber-400 flex shrink-0 items-center justify-center rounded-full">
          <AlertTriangle className="h-4 w-4" />
        </div>
        <div>
          <p className="font-medium text-foreground">{title}</p>
          <p className="mt-0.5 text-muted-foreground">{description}</p>
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 border-amber-500/20 hover:bg-amber-500/8 self-start bg-transparent"
        onClick={onRetry}
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Retry
      </Button>
    </div>
  );
}

function formatChainList(chainIds: ChainId[]): string {
  if (chainIds.length === 0) return "one or more chains";
  const names = chainIds.map(
    (chainId) => chainIdToChain[chainId]?.name ?? `Chain ${chainId}`,
  );
  const [first, second] = names;
  const last = names.at(-1);

  if (names.length === 1 && first) return first;
  if (names.length === 2 && first && second) return `${first} and ${second}`;
  if (last) return `${names.slice(0, -1).join(", ")}, and ${last}`;

  return "one or more chains";
}
