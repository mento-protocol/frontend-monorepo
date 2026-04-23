"use client";

import Image from "next/image";
import type { V2StablecoinsResponse } from "@/lib/types";
import { formatUsd, formatNumber, formatPercent } from "@/lib/format";
import { chainLabel } from "@/lib/chains";
import { useV2Query } from "@/lib/use-v2-query";
import { IconInfo } from "@repo/ui";
import { Tooltip, TooltipTrigger, TooltipContent } from "@repo/ui";
import { TreeTable, type Column, type TreeRow } from "../tree-table";
import { TabSkeleton } from "../tab-skeleton";

type CategoryRow = {
  kind: "category";
  label: string;
  coinCount: number;
  accent: "reserve" | "cdp" | "total";
  debtUsd: number;
  reserveHeldUsd: number;
  netUsd: number;
  mcapPct: number;
};

type CoinRow = {
  kind: "coin";
  symbol: string;
  name: string;
  backing: "reserve" | "cdp";
  networks: string[];
  debtAmount: string;
  debtUsd: number;
  reserveHeldAmount: string;
  reserveHeldUsd: number;
  netAmount: string;
  netUsd: number;
  lostAmount: string;
  lostUsd: number;
  mcapPct: number;
};

type ChainRow = {
  kind: "chain";
  chain: string;
  address: string;
  debtAmount: string;
  debtUsd: number;
  reserveHeldAmount: string;
  reserveHeldUsd: number;
  netAmount: string;
  netUsd: number;
};

type SupplyRow = CategoryRow | CoinRow | ChainRow;

export function StablecoinsTab() {
  const { data: stablecoins } = useV2Query("stablecoins");
  if (!stablecoins) return <TabSkeleton />;
  const rows = buildRows(stablecoins);

  return (
    <div>
      <h2 className="my-6 text-2xl font-medium md:mb-8 md:block hidden">
        Mento Stablecoins
      </h2>
      <p className="mb-6 max-w-xl text-sm text-muted-foreground">
        Debt is the circulating supply redeemable by the public. Reserve-held
        supply sits in reserve wallets and LP positions and is not counted as a
        liability. Expand a row to see the per-stable and per-network breakdown.
      </p>

      <TreeTable<SupplyRow>
        rows={rows}
        columns={columns}
        defaultOpenDepth={1}
        rowClassName={getRowClassName}
        getRowLabel={getSupplyRowLabel}
      />
    </div>
  );
}

function buildRows(stablecoins: V2StablecoinsResponse): TreeRow<SupplyRow>[] {
  const reserveCoins = stablecoins.stablecoins
    .filter((c) => c.backing_type === "reserve")
    .sort((a, b) => b.supply.total_usd - a.supply.total_usd);
  const cdpCoins = stablecoins.stablecoins
    .filter((c) => c.backing_type === "cdp")
    .sort((a, b) => b.supply.total_usd - a.supply.total_usd);

  const coinToRow = (
    c: V2StablecoinsResponse["stablecoins"][number],
  ): TreeRow<SupplyRow> => ({
    id: `coin:${c.symbol}`,
    kind: "coin",
    symbol: c.symbol,
    name: c.name,
    backing: c.backing_type,
    networks: c.networks,
    debtAmount: c.supply.debt,
    debtUsd: c.supply.debt_usd,
    reserveHeldAmount: c.supply.reserve_held,
    reserveHeldUsd: c.supply.reserve_held_usd,
    netAmount: String(parseFloat(c.supply.total) - parseFloat(c.supply.lost)),
    netUsd: c.supply.total_usd - c.supply.lost_usd,
    lostAmount: c.supply.lost,
    lostUsd: c.supply.lost_usd,
    mcapPct: c.market_cap_percentage,
    children: c.network_supplies.map((ns) => ({
      id: `coin:${c.symbol}:${ns.chain}`,
      kind: "chain",
      chain: ns.chain,
      address: ns.address,
      debtAmount: ns.supply.debt,
      debtUsd: ns.supply.debt_usd,
      reserveHeldAmount: ns.supply.reserve_held,
      reserveHeldUsd: ns.supply.reserve_held_usd,
      netAmount: String(
        parseFloat(ns.supply.total) - parseFloat(ns.supply.lost),
      ),
      netUsd: ns.supply.total_usd - ns.supply.lost_usd,
    })),
  });

  const categoryRow = (
    label: string,
    accent: CategoryRow["accent"],
    coins: V2StablecoinsResponse["stablecoins"],
  ): TreeRow<SupplyRow> => {
    const debtUsd = coins.reduce((s, c) => s + c.supply.debt_usd, 0);
    const reserveHeldUsd = coins.reduce(
      (s, c) => s + c.supply.reserve_held_usd,
      0,
    );
    const netUsd = coins.reduce(
      (s, c) => s + c.supply.total_usd - c.supply.lost_usd,
      0,
    );
    const mcapPct = coins.reduce((s, c) => s + c.market_cap_percentage, 0);
    return {
      id: `category:${accent}`,
      kind: "category",
      label,
      coinCount: coins.length,
      accent,
      debtUsd,
      reserveHeldUsd,
      netUsd,
      mcapPct,
      children: coins.map(coinToRow),
    };
  };

  const totalRow: TreeRow<SupplyRow> = {
    id: "category:total",
    kind: "category",
    label: "Total",
    coinCount: stablecoins.stablecoins.length,
    accent: "total",
    debtUsd: stablecoins.total_debt_usd,
    reserveHeldUsd: stablecoins.stablecoins.reduce(
      (s, c) => s + c.supply.reserve_held_usd,
      0,
    ),
    netUsd: stablecoins.stablecoins.reduce(
      (s, c) => s + c.supply.total_usd - c.supply.lost_usd,
      0,
    ),
    mcapPct: 100,
  };

  const result: TreeRow<SupplyRow>[] = [
    categoryRow("Reserve stables", "reserve", reserveCoins),
  ];
  if (cdpCoins.length > 0) {
    result.push(categoryRow("CDP stables", "cdp", cdpCoins));
  }
  result.push(totalRow);
  return result;
}

const columns: Column<SupplyRow>[] = [
  {
    key: "token",
    header: "Token",
    colSpan: (row) => (row.kind === "coin" ? 1 : 3),
    cell: (row) => {
      if (row.kind === "category") {
        return (
          <span className="font-medium">
            {row.label}
            {row.kind === "category" && row.accent !== "total" && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {row.coinCount}{" "}
                {row.coinCount === 1 ? "stablecoin" : "stablecoins"}
              </span>
            )}
          </span>
        );
      }
      if (row.kind === "chain") {
        return (
          <span className="gap-2 inline-flex items-center">
            <NetworkLabel chain={row.chain} />
            <span className="text-xs font-mono max-w-[120px] truncate text-muted-foreground">
              {row.address.slice(0, 6)}...{row.address.slice(-4)}
            </span>
          </span>
        );
      }
      return <CoinLabel coin={row} />;
    },
  },
  {
    key: "backing",
    header: "Backing",
    cell: (row) => {
      if (row.kind !== "coin") return null;
      return (
        <span
          className={`rounded px-1.5 py-0.5 font-medium text-[10px] ${
            row.backing === "cdp"
              ? "bg-amber-500/20 text-amber-400"
              : "bg-[#8c35fd]/20 text-[#8c35fd]"
          }`}
        >
          {row.backing === "cdp" ? "CDP" : "Reserve"}
        </span>
      );
    },
  },
  {
    key: "networks",
    header: "Networks",
    cell: (row) => {
      if (row.kind !== "coin") return null;
      return (
        <span className="gap-1 flex flex-wrap">
          {row.networks.map((n) => (
            <NetworkLabel key={n} chain={n} />
          ))}
        </span>
      );
    },
  },
  {
    key: "debt",
    header: "Debt",
    align: "right",
    cell: (row) => {
      if (row.kind === "category")
        return <CategoryNum>{formatUsd(row.debtUsd)}</CategoryNum>;
      return (
        <SupplyAmount
          amount={row.debtAmount}
          usd={row.debtUsd}
          muted={row.kind === "chain"}
        />
      );
    },
  },
  {
    key: "reserveHeld",
    header: "Reserve-Held",
    align: "right",
    cell: (row) => {
      if (row.kind === "category")
        return <CategoryNum>{formatUsd(row.reserveHeldUsd)}</CategoryNum>;
      return (
        <SupplyAmount
          amount={row.reserveHeldAmount}
          usd={row.reserveHeldUsd}
          muted={row.kind === "chain"}
        />
      );
    },
  },
  {
    key: "net",
    header: "Total Supply",
    align: "right",
    cell: (row) => {
      if (row.kind === "category")
        return <CategoryNum>{formatUsd(row.netUsd)}</CategoryNum>;
      if (row.kind === "chain") {
        return <SupplyAmount amount={row.netAmount} usd={row.netUsd} muted />;
      }
      return (
        <SupplyAmount
          amount={row.netAmount}
          usd={row.netUsd}
          lostNote={
            row.lostUsd > 0
              ? `Excluding ${formatNumber(row.lostAmount)} lost or inaccessible tokens (${formatUsd(row.lostUsd)})`
              : undefined
          }
        />
      );
    },
  },
  {
    key: "mcap",
    header: "% of MCap",
    align: "right",
    cell: (row) => {
      if (row.kind === "chain") return null;
      return (
        <span className={row.kind === "category" ? "font-medium" : undefined}>
          {formatPercent(row.mcapPct)}
        </span>
      );
    },
  },
];

function getRowClassName(row: TreeRow<SupplyRow>, depth: number): string {
  if (row.kind === "category") {
    const accent =
      row.accent === "reserve"
        ? "border-l-4 border-l-[#8c35fd]"
        : row.accent === "cdp"
          ? "border-l-4 border-l-amber-500"
          : "border-t border-[var(--border)]";
    return `${accent} bg-card`;
  }
  if (row.kind === "chain") return "bg-[#15111b]/50";
  if (depth > 0) return "hover:bg-accent transition-colors";
  return "hover:bg-accent transition-colors";
}

function getSupplyRowLabel(row: TreeRow<SupplyRow>): string | undefined {
  if (row.kind === "category") return row.label;
  if (row.kind === "coin") return row.symbol;
  if (row.kind === "chain") return chainLabel(row.chain);
  return undefined;
}

function CategoryNum({ children }: { children: React.ReactNode }) {
  return <span className="font-medium">{children}</span>;
}

function CoinLabel({ coin }: { coin: CoinRow }) {
  return (
    <span className="gap-3 inline-flex items-center">
      <Image
        src={`/tokens/${coin.symbol}.svg`}
        alt={coin.symbol}
        width={28}
        height={28}
        className="h-7 w-7"
        onError={(e) => {
          e.currentTarget.src = "/tokens/CELO.svg";
        }}
      />
      <span>
        <span className="font-medium">{coin.symbol}</span>
        <span className="ml-2 text-xs text-muted-foreground">{coin.name}</span>
      </span>
    </span>
  );
}

function SupplyAmount({
  amount,
  usd,
  muted,
  lostNote,
}: {
  amount: string;
  usd: number;
  muted?: boolean;
  lostNote?: string;
}) {
  return (
    <span className="inline-block">
      <span className={muted ? "text-sm text-muted-foreground" : undefined}>
        {formatNumber(amount)}
        {lostNote && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={lostNote}
                className="ml-1 rounded inline-flex focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
              >
                <IconInfo />
              </button>
            </TooltipTrigger>
            <TooltipContent hideArrow className="max-w-xs">
              {lostNote}
            </TooltipContent>
          </Tooltip>
        )}
      </span>
      <span
        className={`text-xs block ${muted ? "text-muted-foreground/70" : "text-muted-foreground"}`}
      >
        = {formatUsd(usd)}
      </span>
    </span>
  );
}

function NetworkLabel({ chain }: { chain: string }) {
  return (
    <span className="rounded px-1.5 py-0.5 font-medium bg-muted text-[10px] text-muted-foreground">
      {chainLabel(chain)}
    </span>
  );
}
