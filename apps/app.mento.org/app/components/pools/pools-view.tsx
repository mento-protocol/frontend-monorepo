"use client";

import { useState, useMemo } from "react";
import { Search } from "lucide-react";
import { Input, cn } from "@repo/ui";
import { usePoolsList, type PoolFilterType } from "@repo/web3";
import { PoolsTable } from "./pools-table";

const filterTabs: { value: PoolFilterType; label: string }[] = [
  { value: "all", label: "All Pools" },
  { value: "fpmm", label: "FPMM" },
  { value: "legacy", label: "Legacy" },
];

export function PoolsView() {
  const { data: pools = [], isLoading } = usePoolsList();
  const [filter, setFilter] = useState<PoolFilterType>("all");
  const [search, setSearch] = useState("");

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

  return (
    <div className="max-w-5xl space-y-6 w-full">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Pools</h1>
        <p className="text-sm text-muted-foreground">
          Explore pools, view on-chain metrics, and provide liquidity.
        </p>
      </div>

      {/* Filter row */}
      <div className="gap-4 flex items-center justify-between">
        <div className="flex items-center">
          {filterTabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              className={cn(
                "px-4 py-2 text-sm font-medium border-0 transition-colors outline-none",
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
            placeholder="Search by name, symbol or address"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-64 pl-9"
          />
        </div>
      </div>

      {/* Table */}
      <PoolsTable pools={filteredPools} isLoading={isLoading} />

      {/* Legacy footer note */}
      {hasLegacyPools && (
        <div className="px-4 py-3 text-sm rounded-lg border border-border bg-card text-muted-foreground">
          Legacy pools are planned for migration to FPMM. Liquidity actions are
          not available for these pools.
        </div>
      )}
    </div>
  );
}
