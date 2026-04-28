"use client";

import Image from "next/image";
import type { V2ReserveResponse } from "@/lib/types";
import { formatUsd, formatNumber, formatPercent } from "@/lib/format";
import { CHAIN_ICON, chainLabel } from "@/lib/chains";
import { useV2Query } from "@/lib/use-v2-query";
import { TreeTable, type Column, type TreeRow } from "../tree-table";
import { TabSkeleton } from "../tab-skeleton";

const SOURCE_TYPE_LABEL: Record<string, string> = {
  wallet: "Wallet",
  aave: "AAVE",
  univ3: "UniV3",
  fpmm: "FPMM",
  stability_pool: "Stability Pool",
};

const SOURCE_TYPE_COLOR: Record<string, string> = {
  wallet: "bg-muted text-muted-foreground",
  aave: "bg-pink-500/20 text-pink-400",
  univ3: "bg-pink-500/20 text-pink-400",
  fpmm: "bg-[#8c35fd]/20 text-[#8c35fd]",
  stability_pool: "bg-blue-500/20 text-blue-400",
};

type Peg = "usd" | "eur" | "volatile";

const PEG_META: Record<Peg, { label: string; accent: string }> = {
  usd: { label: "$USD backed", accent: "border-l-4 border-l-[#66FFB8]" },
  eur: { label: "€EUR backed", accent: "border-l-4 border-l-[#3D42CD]" },
  volatile: {
    label: "Volatile",
    accent: "border-l-4 border-l-[#7006FC]",
  },
};

// Known stablecoins whose ticker doesn't contain "USD"/"EUR" substring.
// DAI is the legacy MakerDAO USD stable (now USDS, which matches via
// substring) — keeping DAI/sDAI here in case either ticker shows up,
// plus a handful of common USD stables with non-USD tickers.
const USD_PEG_OVERRIDES = new Set([
  "DAI",
  "SDAI",
  "LUSD",
  "FRAX",
  "TUSD",
  "GHO",
]);
const EUR_PEG_OVERRIDES = new Set<string>();

function classifyPeg(symbol: string): Peg {
  const upper = symbol.toUpperCase();
  if (USD_PEG_OVERRIDES.has(upper) || upper.includes("USD")) return "usd";
  if (EUR_PEG_OVERRIDES.has(upper) || upper.includes("EUR")) return "eur";
  return "volatile";
}

type PegRow = {
  kind: "peg";
  peg: Peg;
  totalUsd: number;
  percentage: number;
};
type NetworkRow = {
  kind: "network";
  chain: string;
  totalUsd: number;
  percentage: number;
};
type AssetRow = {
  kind: "asset";
  symbol: string;
  chain: string;
  balance: string;
  usdValue: number;
  percentage: number;
};
type SourceRow = {
  kind: "source";
  sourceType: string;
  label: string;
  balance: string;
  usdValue: number;
};
type TotalRow = {
  kind: "total";
  totalUsd: number;
  percentage: number;
};
type CollateralRow = PegRow | NetworkRow | AssetRow | SourceRow | TotalRow;

type Asset = V2ReserveResponse["collateral"]["assets"][number];

export function CollateralTab() {
  const { data: reserve } = useV2Query("reserve");
  if (!reserve) return <TabSkeleton />;
  const { assets } = reserve.collateral;

  // Show every asset — no dust filter — so the grand Total row in the table
  // genuinely reconciles with reserve.collateral.total_usd / 100%.
  const sorted = [...assets].sort((a, b) => b.usd_value - a.usd_value);

  const rows = buildRows(sorted, reserve.collateral.total_usd, 100);

  return (
    <div>
      <h2 className="mb-6 text-2xl font-medium md:block hidden">
        Reserve Collateral
      </h2>
      <TreeTable<CollateralRow>
        rows={rows}
        columns={columns}
        defaultOpenDepth={2}
        minWidth="600px"
        rowClassName={getRowClassName}
        getRowLabel={getCollateralRowLabel}
      />
    </div>
  );
}

function buildRows(
  sorted: Asset[],
  totalUsd: number,
  totalPct: number,
): TreeRow<CollateralRow>[] {
  const byPeg = new Map<Peg, Asset[]>();
  for (const a of sorted) {
    const peg = classifyPeg(a.symbol);
    if (!byPeg.has(peg)) byPeg.set(peg, []);
    byPeg.get(peg)!.push(a);
  }

  const pegOrder: Peg[] = ["usd", "eur", "volatile"];

  const pegRows: TreeRow<CollateralRow>[] = pegOrder
    .map((peg) => ({ peg, items: byPeg.get(peg) ?? [] }))
    .filter(({ items }) => items.length > 0)
    .map<TreeRow<CollateralRow>>(({ peg, items }) => {
      const pegTotalUsd = items.reduce((s, a) => s + a.usd_value, 0);
      const pegTotalPct = items.reduce((s, a) => s + a.percentage, 0);

      const byChain = new Map<string, Asset[]>();
      for (const a of items) {
        if (!byChain.has(a.chain)) byChain.set(a.chain, []);
        byChain.get(a.chain)!.push(a);
      }

      const networkChildren = [...byChain.entries()]
        .map(([chain, chainAssets]) => ({
          chain,
          chainAssets,
          chainUsd: chainAssets.reduce((s, a) => s + a.usd_value, 0),
          chainPct: chainAssets.reduce((s, a) => s + a.percentage, 0),
        }))
        .sort((a, b) => b.chainUsd - a.chainUsd)
        .map<TreeRow<CollateralRow>>((net) => ({
          id: `peg:${peg}:chain:${net.chain}`,
          kind: "network",
          chain: net.chain,
          totalUsd: net.chainUsd,
          percentage: net.chainPct,
          children: net.chainAssets.map<TreeRow<CollateralRow>>((asset) => ({
            id: `peg:${peg}:chain:${asset.chain}:asset:${asset.symbol}`,
            kind: "asset",
            symbol: asset.symbol,
            chain: asset.chain,
            balance: asset.balance,
            usdValue: asset.usd_value,
            percentage: asset.percentage,
            children: asset.sources.map<TreeRow<CollateralRow>>((s, i) => ({
              id: `peg:${peg}:chain:${asset.chain}:asset:${asset.symbol}:source:${s.identifier}:${i}`,
              kind: "source",
              sourceType: s.type,
              label: s.label,
              balance: s.balance,
              usdValue: s.usd_value,
            })),
          })),
        }));

      return {
        id: `peg:${peg}`,
        kind: "peg",
        peg,
        totalUsd: pegTotalUsd,
        percentage: pegTotalPct,
        children: networkChildren,
      };
    });

  const totalRow: TreeRow<CollateralRow> = {
    id: "total",
    kind: "total",
    totalUsd,
    percentage: totalPct,
  };

  return [...pegRows, totalRow];
}

const columns: Column<CollateralRow>[] = [
  {
    key: "asset",
    header: "Asset",
    width: "40%",
    cell: (row) => {
      if (row.kind === "peg") {
        return <span className="font-medium">{PEG_META[row.peg].label}</span>;
      }
      if (row.kind === "network") {
        const iconSrc = CHAIN_ICON[row.chain];
        const label = chainLabel(row.chain);
        return (
          <span className="gap-2 inline-flex items-center">
            {iconSrc && (
              <Image
                src={iconSrc}
                alt={label}
                width={20}
                height={20}
                className="h-5 w-5"
              />
            )}
            <span className="font-medium">{label}</span>
          </span>
        );
      }
      if (row.kind === "asset") {
        return (
          <span className="gap-3 inline-flex items-center">
            <Image
              src={`/tokens/${row.symbol}.svg`}
              alt={row.symbol}
              width={28}
              height={28}
              className="h-7 w-7"
              onError={(e) => {
                e.currentTarget.src = "/tokens/CELO.svg";
              }}
            />
            <span className="font-medium">{row.symbol}</span>
          </span>
        );
      }
      if (row.kind === "source") {
        return (
          <span className="gap-2 inline-flex items-center">
            <span
              className={`rounded px-1.5 py-0.5 font-medium text-[10px] ${
                SOURCE_TYPE_COLOR[row.sourceType] ??
                "bg-muted text-muted-foreground"
              }`}
            >
              {SOURCE_TYPE_LABEL[row.sourceType] ?? row.sourceType}
            </span>
            <span className="text-sm text-muted-foreground">{row.label}</span>
          </span>
        );
      }
      return <span className="font-medium">Total</span>;
    },
  },
  {
    key: "amount",
    header: "Amount",
    align: "right",
    width: "20%",
    cell: (row) => {
      if (row.kind === "asset") return formatNumber(row.balance, 2);
      if (row.kind === "source") {
        return (
          <span className="text-sm text-muted-foreground">
            {formatNumber(row.balance, 2)}
          </span>
        );
      }
      return null;
    },
  },
  {
    key: "usd",
    header: "Value (USD)",
    align: "right",
    width: "25%",
    cell: (row) => {
      if (row.kind === "peg" || row.kind === "total" || row.kind === "network")
        return <span className="font-medium">{formatUsd(row.totalUsd)}</span>;
      if (row.kind === "asset") return formatUsd(row.usdValue);
      return (
        <span className="text-sm text-muted-foreground">
          {formatUsd(row.usdValue)}
        </span>
      );
    },
  },
  {
    key: "pct",
    header: "%",
    align: "right",
    width: "15%",
    cell: (row) => {
      if (row.kind === "source") return null;
      return (
        <span
          className={
            row.kind === "peg" || row.kind === "total" || row.kind === "network"
              ? "font-medium"
              : undefined
          }
        >
          {formatPercent(row.percentage)}
        </span>
      );
    },
  },
];

function getRowClassName(row: TreeRow<CollateralRow>): string {
  if (row.kind === "peg") {
    return `${PEG_META[row.peg].accent} bg-card`;
  }
  if (row.kind === "network") return "bg-card/40";
  if (row.kind === "total") return "border-t border-[var(--border)] bg-card";
  if (row.kind === "source") return "bg-[#15111b]/50";
  return "";
}

function getCollateralRowLabel(
  row: TreeRow<CollateralRow>,
): string | undefined {
  if (row.kind === "peg") return PEG_META[row.peg].label;
  if (row.kind === "network") return chainLabel(row.chain);
  if (row.kind === "asset") return row.symbol;
  if (row.kind === "source") return row.label;
  if (row.kind === "total") return "Total";
  return undefined;
}
