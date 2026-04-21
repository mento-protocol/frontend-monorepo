"use client";

import { useState } from "react";
import type { ChartSegment } from "@repo/ui";
import { ReserveChart } from "@repo/ui";
import Image from "next/image";
import type { V2ReserveResponse } from "@/lib/types";
import { formatUsd, formatNumber, formatPercent } from "@/lib/format";
import { TreeTable, type Column, type TreeRow } from "../tree-table";

const TOKEN_COLORS: Record<string, string> = {
  CELO: "#7006FC",
  ETH: "#66FFB8",
  BTC: "#FFFFFF",
  SUSDS: "#99FFCF",
  USDC: "#C69BFF",
  EURC: "#3D42CD",
  DAI: "#F7F6FA",
  STETH: "#7579FF",
  WBTC: "#F7F6FA",
  USDT: "#0A452A",
  USDGLO: "#082831",
  STEUR: "#18A061",
  AUSD: "#9CA3AF",
};

function getTokenColor(symbol: string): string {
  return TOKEN_COLORS[symbol.toUpperCase()] ?? "#fff000";
}

const CHAIN_LABEL: Record<string, string> = {
  celo: "Celo",
  ethereum: "Ethereum",
  monad: "Monad",
  bitcoin: "Bitcoin",
};

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
  usd: { label: "USD-pegged", accent: "border-l-4 border-l-[#66FFB8]" },
  eur: { label: "EUR-pegged", accent: "border-l-4 border-l-[#3D42CD]" },
  volatile: {
    label: "Volatile",
    accent: "border-l-4 border-l-[#7006FC]",
  },
};

function classifyPeg(symbol: string): Peg {
  const upper = symbol.toUpperCase();
  if (upper.includes("USD")) return "usd";
  if (upper.includes("EUR")) return "eur";
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

export function CollateralTab({ reserve }: { reserve: V2ReserveResponse }) {
  const [active, setActive] = useState<string>();
  const { assets } = reserve.collateral;

  const meaningful = assets.filter((a) => a.usd_value >= 1);
  const sorted = [...meaningful].sort((a, b) => b.usd_value - a.usd_value);
  const displayedTotalUsd = sorted.reduce((s, a) => s + a.usd_value, 0);
  const displayedTotalPct = sorted.reduce((s, a) => s + a.percentage, 0);

  const chartBySymbol = new Map<string, number>();
  for (const a of sorted) {
    chartBySymbol.set(
      a.symbol,
      (chartBySymbol.get(a.symbol) ?? 0) + a.percentage,
    );
  }
  const chartData: ChartSegment[] = [...chartBySymbol.entries()].map(
    ([symbol, pct]) => ({
      name: symbol,
      value: pct,
      color: getTokenColor(symbol),
    }),
  );

  const largestSegment =
    chartData.length > 0
      ? chartData.reduce((a, b) => (a.value > b.value ? a : b))
      : null;
  const centerText = largestSegment
    ? `${largestSegment.value.toFixed(2)}%`
    : "Reserve";

  const rows = buildRows(sorted, displayedTotalUsd, displayedTotalPct);

  return (
    <div>
      <div className="gap-2 md:mt-0 md:grid md:grid-cols-12 flex flex-col">
        <div className="mb-2 p-6 pb-20 md:col-span-6 md:mb-0 xl:col-span-4 flex h-full flex-1 flex-col bg-card">
          <h2 className="text-2xl font-medium md:block relative z-10 hidden">
            Reserve Collateral
          </h2>
          <ReserveChart
            data={chartData}
            centerText={centerText}
            activeSegment={active}
            className="lg:h-[320px] xl:h-[360px] 2xl:h-[480px] my-auto h-[288px] justify-center self-center min-[2500px]:!h-[640px]"
            onActiveChanged={(name) => {
              setActive(name);
            }}
          />
        </div>
        <div className="md:col-span-6 xl:col-span-8">
          <TreeTable<CollateralRow>
            rows={rows}
            columns={columns}
            defaultOpenDepth={2}
            minWidth="600px"
            rowClassName={(row) => getRowClassName(row, active)}
            onRowMouseEnter={(row) => {
              if (row.kind === "asset") setActive(row.symbol);
            }}
            onRowMouseLeave={(row) => {
              if (row.kind === "asset") setActive(undefined);
            }}
          />
        </div>
      </div>
    </div>
  );
}

function buildRows(
  sorted: Asset[],
  totalUsd: number,
  totalPct: number,
): TreeRow<CollateralRow>[] {
  // Bucket assets by peg, then by chain within each peg.
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

      // Group this peg's assets by chain.
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
        return (
          <span className="gap-2 inline-flex items-center">
            <span className="rounded px-1.5 py-0.5 font-medium bg-muted text-[10px] text-muted-foreground">
              {CHAIN_LABEL[row.chain] ?? row.chain}
            </span>
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
      if (row.kind === "peg" || row.kind === "total")
        return <span className="font-medium">{formatUsd(row.totalUsd)}</span>;
      if (row.kind === "network")
        return (
          <span className="text-sm font-medium">
            {formatUsd(row.totalUsd)}
          </span>
        );
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
            row.kind === "peg" || row.kind === "total"
              ? "font-medium"
              : row.kind === "network"
                ? "text-sm font-medium"
                : undefined
          }
        >
          {formatPercent(row.percentage)}
        </span>
      );
    },
  },
];

function getRowClassName(
  row: TreeRow<CollateralRow>,
  active: string | undefined,
): string {
  if (row.kind === "peg") {
    return `${PEG_META[row.peg].accent} bg-card`;
  }
  if (row.kind === "network") return "bg-card/40";
  if (row.kind === "total") return "border-t border-[var(--border)] bg-card";
  if (row.kind === "source") return "bg-[#15111b]/50";
  // asset: apply bg-accent when this symbol is active from the donut so
  // donut-driven highlighting works even without a direct hover.
  return row.symbol === active ? "bg-accent" : "";
}
