"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, Droplets, RefreshCw } from "lucide-react";
import { Button, Input, cn } from "@repo/ui";
import {
  usePoolsList,
  chainIdToSlug,
  type PoolFilterType,
  type PoolDisplay,
} from "@repo/web3";
import { useChainId } from "@repo/web3/wagmi";
import { PoolsTable } from "./pools-table";
import { LiquidityFlowDialog } from "./liquidity-flow-dialog";

const filterTabs: { value: PoolFilterType; label: string }[] = [
  { value: "all", label: "All Pools" },
  { value: "fpmm", label: "FPMM" },
  { value: "legacy", label: "Legacy" },
];

export function PoolsView() {
  const { data: pools = [], isLoading, isError, refetch } = usePoolsList();
  const [filter, setFilter] = useState<PoolFilterType>("all");
  const [search, setSearch] = useState("");
  const router = useRouter();
  const chainId = useChainId();

  const handleSelectPool = useCallback(
    (pool: PoolDisplay, mode: "deposit" | "manage") => {
      const slug = chainIdToSlug(chainId);
      const modeParam = mode === "manage" ? "?mode=manage" : "";
      router.push(`/pools/${slug}/${pool.poolAddr}${modeParam}`);
    },
    [chainId, router],
  );

  const filteredPools = useMemo(() => {
    let result = pools;

    if (filter === "fpmm") {
      result = result.filter((p) => p.poolType === "FPMM");
    } else if (filter === "legacy") {
      result = result.filter((p) => p.poolType === "Legacy");
    }

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
  }, [pools, filter, search]);

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
              Explore pools, view on-chain metrics, and provide liquidity.
            </p>
          </div>
        </div>

        {!showPoolsError && (isLoading || pools.length > 0) && (
          <div className="gap-4 md:flex-row md:items-center md:justify-between flex flex-col">
            <div className="md:w-auto md:justify-start flex w-full items-center justify-center">
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
            </div>
            <div className="relative">
              <Search className="left-3 h-4 w-4 absolute top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name, symbol or pool address"
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
        The pools list could not be loaded from the current RPC right now. Try
        again in a moment.
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
      {/* Top accent line */}
      <div className="top-0 w-48 absolute left-1/2 h-[2px] -translate-x-1/2 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

      {/* Icon */}
      <div className="mb-7 flex justify-center">
        <div className="h-14 w-14 flex items-center justify-center rounded-full bg-primary/10">
          <Droplets className="h-7 w-7 text-primary" />
        </div>
      </div>

      <h2 className="mb-2.5 text-xl font-bold tracking-tight">
        No pools on this network yet
      </h2>
      <p className="max-w-sm text-sm leading-relaxed mx-auto text-muted-foreground">
        Pools are not available on this network yet. Switch to Celo to explore
        pools, view on-chain metrics, and provide liquidity.
      </p>
    </div>
  );
}
