"use client";

import Image from "next/image";
import { chainLabel } from "@/lib/chains";
import { formatNumber, formatPercent, formatUsd } from "@/lib/format";
import { AddressLabel } from "../../address-label";
import { TreeTable, type Column, type TreeRow } from "../../tree-table";
import { lookupDescription } from "./normalize";
import type { AddressDescriptionMap, HoldingEntry, OpRow } from "./types";

export function OperationalHoldingsSection({
  holdings,
  descriptionMap,
}: {
  holdings: HoldingEntry[];
  descriptionMap: AddressDescriptionMap;
}) {
  const grouped = new Map<
    string,
    {
      symbol: string;
      totalBalance: number;
      totalUsd: number;
      custodies: HoldingEntry[];
    }
  >();

  for (const holding of holdings) {
    let group = grouped.get(holding.token);
    if (!group) {
      group = {
        symbol: holding.token,
        totalBalance: 0,
        totalUsd: 0,
        custodies: [],
      };
      grouped.set(holding.token, group);
    }
    group.totalBalance += parseFloat(holding.balance);
    group.totalUsd += holding.usd_value;
    group.custodies.push(holding);
  }

  const assets = [...grouped.values()].sort((a, b) => b.totalUsd - a.totalUsd);
  const totalUsd = assets.reduce((sum, asset) => sum + asset.totalUsd, 0);
  const rows: TreeRow<OpRow>[] = assets.map((asset) => ({
    id: `op:${asset.symbol}`,
    kind: "opAsset",
    symbol: asset.symbol,
    balance: asset.totalBalance,
    usd: asset.totalUsd,
    pct: totalUsd > 0 ? (asset.totalUsd / totalUsd) * 100 : 0,
    children:
      asset.custodies.length > 1
        ? asset.custodies.map<TreeRow<OpRow>>((custody, index) => ({
            id: `op:${asset.symbol}:${custody.address}:${custody.chain}:${index}`,
            kind: "opCustody",
            chain: custody.chain,
            label: custody.label,
            address: custody.address,
            description: lookupDescription(descriptionMap, custody.address),
            balance: custody.balance,
            usd: custody.usd_value,
          }))
        : undefined,
  }));

  rows.push({ id: "op:total", kind: "opTotal", usd: totalUsd });

  return (
    <div>
      <h2 className="mb-2 text-2xl font-medium">Operational Holdings</h2>
      <p className="mb-6 max-w-xl text-sm text-muted-foreground">
        Mento stablecoins held directly in reserve wallets. Not counted as
        reserve liabilities.
      </p>
      <TreeTable<OpRow>
        rows={rows}
        columns={opColumns}
        defaultOpenDepth={0}
        minWidth="600px"
        rowClassName={opRowClassName}
        getRowLabel={(row) => (row.kind === "opAsset" ? row.symbol : undefined)}
      />
    </div>
  );
}

const opColumns: Column<OpRow>[] = [
  {
    key: "asset",
    header: "Asset",
    width: "40%",
    cell: (row) => {
      if (row.kind === "opAsset") {
        return (
          <span className="gap-3 inline-flex items-center">
            <Image
              src={`/tokens/${row.symbol}.svg`}
              alt={row.symbol}
              width={28}
              height={28}
              className="h-7 w-7"
              onError={(event) => {
                event.currentTarget.src = "/tokens/CELO.svg";
              }}
            />
            <span className="font-medium">{row.symbol}</span>
          </span>
        );
      }

      if (row.kind === "opCustody") {
        return (
          <span className="gap-2 inline-flex items-center">
            <span className="rounded px-1.5 py-0.5 font-medium bg-muted text-[10px] text-muted-foreground">
              {chainLabel(row.chain)}
            </span>
            <AddressLabel
              variant="compact"
              label={row.label}
              address={row.address}
              chain={row.chain}
              description={row.description}
              context="positions_tab:operational_holdings"
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
      if (row.kind === "opAsset") return formatNumber(row.balance, 2);
      if (row.kind === "opCustody") {
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
      if (row.kind === "opAsset") return formatUsd(row.usd);
      if (row.kind === "opCustody") {
        return (
          <span className="text-sm text-muted-foreground">
            {formatUsd(row.usd)}
          </span>
        );
      }
      return <span className="font-medium">{formatUsd(row.usd)}</span>;
    },
  },
  {
    key: "pct",
    header: "%",
    align: "right",
    width: "15%",
    cell: (row) => {
      if (row.kind === "opAsset") return formatPercent(row.pct);
      if (row.kind === "opTotal")
        return <span className="font-medium">100%</span>;
      return null;
    },
  },
];

function opRowClassName(row: TreeRow<OpRow>): string {
  if (row.kind === "opCustody") return "bg-[#15111b]/50";
  if (row.kind === "opTotal") return "border-t border-[var(--border)] bg-card";
  return "transition-colors hover:bg-accent";
}
