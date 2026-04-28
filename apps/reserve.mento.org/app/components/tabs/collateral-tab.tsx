"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui";
import type { V2ReserveResponse, CollateralSource } from "@/lib/types";
import { formatUsd, formatNumber, formatPercent } from "@/lib/format";
import { CHAIN_ICON, chainLabel } from "@/lib/chains";
import { useV2Query } from "@/lib/use-v2-query";
import { CUSTODY_META, CUSTODY_ORDER, type CustodyType } from "@/lib/custody";
import { AddressLabel } from "../address-label";
import { TreeTable, type Column, type TreeRow } from "../tree-table";
import { TabSkeleton } from "../tab-skeleton";
import { SunburstChart, type SunburstNode } from "../sunburst-chart";

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

const PEG_META: Record<Peg, { label: string; accent: string; color: string }> =
  {
    usd: {
      label: "$USD backed",
      accent: "border-l-4 border-l-[#66FFB8]",
      color: "#66FFB8",
    },
    eur: {
      label: "€EUR backed",
      accent: "border-l-4 border-l-[#3D42CD]",
      color: "#3D42CD",
    },
    volatile: {
      label: "Volatile",
      accent: "border-l-4 border-l-[#7006FC]",
      color: "#7006FC",
    },
  };

const CHAIN_COLOR: Record<string, string> = {
  celo: "#FBCC5C",
  ethereum: "#627EEA",
  bitcoin: "#F7931A",
  monad: "#7006FC",
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

type GroupingMode = "asset-type" | "custody" | "network";

type PegRow = {
  kind: "peg";
  peg: Peg;
  totalUsd: number;
  percentage: number;
};
type CustodyRow = {
  kind: "custody-type";
  custody: CustodyType;
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
  identifier: string;
  chain: string;
  balance: string;
  usdValue: number;
};
type TotalRow = {
  kind: "total";
  totalUsd: number;
  percentage: number;
};
type CollateralRow =
  | PegRow
  | CustodyRow
  | NetworkRow
  | AssetRow
  | SourceRow
  | TotalRow;

type Asset = V2ReserveResponse["collateral"]["assets"][number];

// Pre-flattened (asset, source) record for grouping modes that
// re-aggregate by source rather than by asset.
type SourceRecord = {
  source: CollateralSource;
  symbol: string;
  chain: string;
  // Token balance attributed to this source. The API gives usd_value
  // per source but only an aggregate balance per asset; we pro-rate by
  // the source's USD share so per-source rows still display amounts.
  balance: string;
};

export function CollateralTab() {
  const { data: reserve } = useV2Query("reserve");
  const [mode, setMode] = useState<GroupingMode>("asset-type");
  const [hoverId, setHoverId] = useState<string | null>(null);

  const buildContext = useMemo(() => {
    if (!reserve) return null;
    const sorted = [...reserve.collateral.assets].sort(
      (a, b) => b.usd_value - a.usd_value,
    );
    return {
      sorted,
      totalUsd: reserve.collateral.total_usd,
      byCustodian: reserve.collateral.by_custodian,
    };
  }, [reserve]);

  const rows = useMemo<TreeRow<CollateralRow>[]>(() => {
    if (!buildContext) return [];
    const { sorted, totalUsd, byCustodian } = buildContext;
    if (mode === "asset-type") return buildRows(sorted, totalUsd, 100);
    if (mode === "custody")
      return buildRowsByCustody(sorted, totalUsd, 100, byCustodian);
    return buildRowsByNetwork(sorted, totalUsd, 100);
  }, [buildContext, mode]);

  const sunburstData = useMemo<SunburstNode[]>(
    () => buildSunburst(rows),
    [rows],
  );

  if (!reserve || !buildContext) return <TabSkeleton />;

  // 4-level asset-type benefits from defaultOpenDepth=2 (peg → network).
  // 3-level modes show second level (asset / custodian) by opening 1 deep.
  const defaultOpenDepth = mode === "asset-type" ? 2 : 1;

  return (
    <div>
      <div className="md:flex-row md:items-center md:justify-between gap-4 mb-6 flex flex-col">
        <h2 className="text-2xl font-medium md:block hidden">
          Reserve Collateral
        </h2>
        <div className="md:flex-row md:items-center gap-2 flex flex-col">
          <label
            htmlFor="collateral-grouping"
            className="text-sm text-muted-foreground"
          >
            Grouping by:
          </label>
          <Select
            value={mode}
            onValueChange={(value) => {
              setMode(value as GroupingMode);
              setHoverId(null);
            }}
          >
            <SelectTrigger id="collateral-grouping" className="md:w-44 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="asset-type">Asset type</SelectItem>
              <SelectItem value="custody">Custody</SelectItem>
              <SelectItem value="network">Network</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="lg:grid-cols-[auto_1fr] lg:items-start gap-6 grid grid-cols-1">
        <div className="lg:justify-start flex justify-center">
          <SunburstChart
            data={sunburstData}
            total={reserve.collateral.total_usd}
            hoverId={hoverId}
            onHoverChange={setHoverId}
          />
        </div>
        <TreeTable<CollateralRow>
          key={mode}
          rows={rows}
          columns={columns}
          defaultOpenDepth={defaultOpenDepth}
          minWidth="600px"
          rowClassName={(row, depth) =>
            getRowClassNameWithHover(row, depth, hoverId)
          }
          onRowMouseEnter={(row) => {
            if (row.kind === "total") return;
            setHoverId(row.id);
          }}
          onRowMouseLeave={() => setHoverId(null)}
          getRowLabel={getCollateralRowLabel}
        />
      </div>
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
              identifier: s.identifier,
              chain: asset.chain,
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

// Flatten (asset, source) pairs and pro-rate the asset-level balance
// across sources using the source's USD share.
function flattenSources(assets: Asset[]): SourceRecord[] {
  const records: SourceRecord[] = [];
  for (const asset of assets) {
    const assetTotal = asset.sources.reduce((s, src) => s + src.usd_value, 0);
    for (const source of asset.sources) {
      const share = assetTotal > 0 ? source.usd_value / assetTotal : 0;
      const numericBalance = parseFloat(asset.balance);
      const proRated = Number.isFinite(numericBalance)
        ? (numericBalance * share).toString()
        : asset.balance;
      records.push({
        source,
        symbol: asset.symbol,
        chain: asset.chain,
        balance: proRated,
      });
    }
  }
  return records;
}

function buildRowsByCustody(
  sorted: Asset[],
  totalUsd: number,
  totalPct: number,
  byCustodian: V2ReserveResponse["collateral"]["by_custodian"],
): TreeRow<CollateralRow>[] {
  const records = flattenSources(sorted);

  const byCustody = new Map<CustodyType, SourceRecord[]>();
  for (const rec of records) {
    const custody = rec.source.custodian_type;
    if (!byCustody.has(custody)) byCustody.set(custody, []);
    byCustody.get(custody)!.push(rec);
  }

  // API-provided totals are authoritative — preferring them over a
  // sum-of-children avoids drift when the wire format changes (e.g.
  // sources merged or filtered server-side).
  const apiTotalsByCustody: Record<CustodyType, number> = {
    hot: byCustodian.hot_usd,
    cold: byCustodian.cold_usd,
    ops: byCustodian.ops_usd,
  };

  const custodyRows: TreeRow<CollateralRow>[] = CUSTODY_ORDER.map(
    (custody) => ({
      custody,
      items: byCustody.get(custody) ?? [],
    }),
  )
    .filter(({ items }) => items.length > 0)
    .map<TreeRow<CollateralRow>>(({ custody, items }) => {
      const custodyUsd = apiTotalsByCustody[custody];
      const custodyPct = totalUsd > 0 ? (custodyUsd / totalUsd) * 100 : 0;

      // Group by asset symbol; custody buckets cross chains so we
      // collapse same-symbol records (e.g. USDC on Celo + Ethereum).
      const bySymbol = new Map<string, SourceRecord[]>();
      for (const rec of items) {
        if (!bySymbol.has(rec.symbol)) bySymbol.set(rec.symbol, []);
        bySymbol.get(rec.symbol)!.push(rec);
      }

      const assetChildren = [...bySymbol.entries()]
        .map(([symbol, recs]) => ({
          symbol,
          recs,
          assetUsd: recs.reduce((s, r) => s + r.source.usd_value, 0),
          assetBalance: recs.reduce((s, r) => {
            const n = parseFloat(r.balance);
            return Number.isFinite(n) ? s + n : s;
          }, 0),
          chain: recs[0]!.chain,
        }))
        .sort((a, b) => b.assetUsd - a.assetUsd)
        .map<TreeRow<CollateralRow>>((entry) => ({
          id: `custody:${custody}:asset:${entry.symbol}`,
          kind: "asset",
          symbol: entry.symbol,
          chain: entry.chain,
          balance: entry.assetBalance.toString(),
          usdValue: entry.assetUsd,
          percentage: totalUsd > 0 ? (entry.assetUsd / totalUsd) * 100 : 0,
          children: entry.recs
            .slice()
            .sort((a, b) => b.source.usd_value - a.source.usd_value)
            .map<TreeRow<CollateralRow>>((rec, i) => ({
              id: `custody:${custody}:asset:${entry.symbol}:source:${rec.source.identifier}:${i}`,
              kind: "source",
              sourceType: rec.source.type,
              label: rec.source.label,
              identifier: rec.source.identifier,
              chain: rec.chain,
              balance: rec.balance,
              usdValue: rec.source.usd_value,
            })),
        }));

      return {
        id: `custody:${custody}`,
        kind: "custody-type",
        custody,
        totalUsd: custodyUsd,
        percentage: custodyPct,
        children: assetChildren,
      };
    });

  const totalRow: TreeRow<CollateralRow> = {
    id: "total",
    kind: "total",
    totalUsd,
    percentage: totalPct,
  };

  return [...custodyRows, totalRow];
}

function buildRowsByNetwork(
  sorted: Asset[],
  totalUsd: number,
  totalPct: number,
): TreeRow<CollateralRow>[] {
  const byChain = new Map<string, Asset[]>();
  for (const a of sorted) {
    if (!byChain.has(a.chain)) byChain.set(a.chain, []);
    byChain.get(a.chain)!.push(a);
  }

  const networkRows: TreeRow<CollateralRow>[] = [...byChain.entries()]
    .map(([chain, chainAssets]) => ({
      chain,
      chainAssets,
      chainUsd: chainAssets.reduce((s, a) => s + a.usd_value, 0),
      chainPct: chainAssets.reduce((s, a) => s + a.percentage, 0),
    }))
    .sort((a, b) => b.chainUsd - a.chainUsd)
    .map<TreeRow<CollateralRow>>((net) => ({
      id: `chain:${net.chain}`,
      kind: "network",
      chain: net.chain,
      totalUsd: net.chainUsd,
      percentage: net.chainPct,
      children: net.chainAssets.map<TreeRow<CollateralRow>>((asset) => ({
        id: `chain:${asset.chain}:asset:${asset.symbol}`,
        kind: "asset",
        symbol: asset.symbol,
        chain: asset.chain,
        balance: asset.balance,
        usdValue: asset.usd_value,
        percentage: asset.percentage,
        children: asset.sources.map<TreeRow<CollateralRow>>((s, i) => ({
          id: `chain:${asset.chain}:asset:${asset.symbol}:source:${s.identifier}:${i}`,
          kind: "source",
          sourceType: s.type,
          label: s.label,
          identifier: s.identifier,
          chain: asset.chain,
          balance: s.balance,
          usdValue: s.usd_value,
        })),
      })),
    }));

  const totalRow: TreeRow<CollateralRow> = {
    id: "total",
    kind: "total",
    totalUsd,
    percentage: totalPct,
  };

  return [...networkRows, totalRow];
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
      if (row.kind === "custody-type") {
        return (
          <span className="font-medium">{CUSTODY_META[row.custody].label}</span>
        );
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
            <AddressLabel
              variant="compact"
              label={row.label}
              identifier={row.identifier}
              chain={row.chain}
              context={`collateral_tab:${row.sourceType}`}
            />
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
      if (
        row.kind === "peg" ||
        row.kind === "custody-type" ||
        row.kind === "total" ||
        row.kind === "network"
      )
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
            row.kind === "peg" ||
            row.kind === "custody-type" ||
            row.kind === "total" ||
            row.kind === "network"
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
  if (row.kind === "custody-type") {
    return `${CUSTODY_META[row.custody].accent} bg-card`;
  }
  if (row.kind === "network") return "bg-card/40";
  if (row.kind === "total") return "border-t border-[var(--border)] bg-card";
  if (row.kind === "source") return "bg-[#15111b]/50";
  return "";
}

function getRowClassNameWithHover(
  row: TreeRow<CollateralRow>,
  depth: number,
  hoverId: string | null,
): string {
  const base = getRowClassName(row);
  if (!hoverId || row.kind === "total") return base;
  if (row.id === hoverId) return `${base} ring-1 ring-inset ring-[#7006FC]`;
  // Dim non-matching, non-ancestor rows so the hovered branch stands out.
  // An ancestor's id is a prefix of the descendant's id (we build ids by
  // appending segments), so a startsWith check identifies the hovered row's
  // ancestors and descendants.
  const isRelated =
    hoverId.startsWith(`${row.id}:`) || row.id.startsWith(`${hoverId}:`);
  if (isRelated) return base;
  return `${base} opacity-50`;
}

function getCollateralRowLabel(
  row: TreeRow<CollateralRow>,
): string | undefined {
  if (row.kind === "peg") return PEG_META[row.peg].label;
  if (row.kind === "custody-type") return CUSTODY_META[row.custody].label;
  if (row.kind === "network") return chainLabel(row.chain);
  if (row.kind === "asset") return row.symbol;
  if (row.kind === "source") return row.label;
  if (row.kind === "total") return "Total";
  return undefined;
}

// Convert the visible TreeRow tree into a SunburstNode tree, dropping
// the synthetic "total" footer row and assigning a base color to each
// top-level group so child rings can lighten consistently.
function buildSunburst(rows: TreeRow<CollateralRow>[]): SunburstNode[] {
  return rows
    .filter((r) => r.kind !== "total")
    .map((r) => toSunburstNode(r, true));
}

function toSunburstNode(
  row: TreeRow<CollateralRow>,
  isRoot: boolean,
): SunburstNode {
  const children = row.children
    ?.filter((c) => c.kind !== "total")
    .map((c) => toSunburstNode(c, false));
  return {
    id: row.id,
    label: sunburstLabel(row),
    value: sunburstValue(row),
    color: isRoot ? rootColor(row) : undefined,
    children: children?.length ? children : undefined,
  };
}

function sunburstLabel(row: TreeRow<CollateralRow>): string {
  if (row.kind === "peg") return PEG_META[row.peg].label;
  if (row.kind === "custody-type") return CUSTODY_META[row.custody].label;
  if (row.kind === "network") return chainLabel(row.chain);
  if (row.kind === "asset") return row.symbol;
  if (row.kind === "source") return row.label;
  return "Total";
}

function sunburstValue(row: TreeRow<CollateralRow>): number {
  if (
    row.kind === "peg" ||
    row.kind === "custody-type" ||
    row.kind === "network"
  )
    return row.totalUsd;
  if (row.kind === "asset") return row.usdValue;
  if (row.kind === "source") return row.usdValue;
  if (row.kind === "total") return row.totalUsd;
  return 0;
}

function rootColor(row: TreeRow<CollateralRow>): string | undefined {
  if (row.kind === "peg") return PEG_META[row.peg].color;
  if (row.kind === "custody-type") return CUSTODY_META[row.custody].color;
  if (row.kind === "network") return CHAIN_COLOR[row.chain];
  return undefined;
}
