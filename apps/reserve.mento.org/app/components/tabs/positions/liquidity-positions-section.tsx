"use client";

import Image from "next/image";
import { chainLabel } from "@/lib/chains";
import { formatNumber, formatUsd } from "@/lib/format";
import { AddressLabel } from "../../address-label";
import { TreeTable, type Column, type TreeRow } from "../../tree-table";
import {
  aggregateTokens,
  lookupDescription,
  sortTokensBySymbol,
  sumUsd,
} from "./normalize";
import {
  PROTOCOL_BORDER,
  PROTOCOL_LOGO,
  PROTOCOL_ORDER,
  type AddressDescriptionMap,
  type LiquidityPosition,
  type LiquidityRow,
  type Protocol,
  type Token,
} from "./types";

export function LiquidityPositionsSection({
  positions,
  descriptionMap,
}: {
  positions: LiquidityPosition[];
  descriptionMap: AddressDescriptionMap;
}) {
  const byProtocol = new Map<Protocol, LiquidityPosition[]>();
  for (const position of positions) {
    if (!byProtocol.has(position.protocol)) {
      byProtocol.set(position.protocol, []);
    }
    byProtocol.get(position.protocol)!.push(position);
  }
  const rows: TreeRow<LiquidityRow>[] = [];
  let grandMentoUsd = 0;
  let grandCollUsd = 0;
  for (const protocol of PROTOCOL_ORDER) {
    const items = byProtocol.get(protocol);
    if (!items || items.length === 0) continue;
    const mentoUsd = sumUsd(items, (token) => token.isMentoStable);
    const collateralUsd = sumUsd(items, (token) => !token.isMentoStable);
    const aggregated = aggregateTokens(items);
    const mentoTokens = sortTokensBySymbol(
      aggregated.filter((token) => token.isMentoStable),
    );
    const collateralTokens = sortTokensBySymbol(
      aggregated.filter((token) => !token.isMentoStable),
    );

    grandMentoUsd += mentoUsd;
    grandCollUsd += collateralUsd;
    rows.push({
      id: `liq:${protocol}:total`,
      kind: "protoTotal",
      protocol,
      mentoUsd,
      collateralUsd,
      positionCount: items.length,
      children: items.map<TreeRow<LiquidityRow>>((position, index) => {
        const nonZero = position.tokens.filter((token) => token.amount > 0);
        return {
          id: `liq:${protocol}:pos:${position.positionName}:${index}`,
          kind: "position",
          protocol,
          name: position.positionName,
          chain: position.chain,
          holder: position.holder,
          holderAddress: position.holderAddress,
          holderDescription: lookupDescription(
            descriptionMap,
            position.holderAddress,
          ),
          mentoTokens: sortTokensBySymbol(
            nonZero.filter((token) => token.isMentoStable),
          ),
          collateralTokens: sortTokensBySymbol(
            nonZero.filter((token) => !token.isMentoStable),
          ),
        };
      }),
    });

    rows.push({
      id: `liq:${protocol}:subtotals`,
      kind: "protoSubtotals",
      protocol,
      mentoTokens,
      collateralTokens,
    });
  }
  rows.push({
    id: "liq:grand",
    kind: "grandLiquidityTotal",
    mentoUsd: grandMentoUsd,
    collateralUsd: grandCollUsd,
  });

  return (
    <div>
      <h2 className="mb-2 text-2xl font-medium">Liquidity Positions</h2>
      <p className="mb-6 max-w-xl text-sm text-muted-foreground">
        Reserve-held positions across AAVE, Uniswap V3, Mento FPMM pools, and
        Liquity V2 stability pools.
      </p>
      <TreeTable<LiquidityRow>
        rows={rows}
        columns={liquidityColumns}
        defaultOpenDepth={0}
        minWidth="900px"
        rowClassName={liquidityRowClassName}
        getRowLabel={(row) =>
          row.kind === "protoTotal" ? row.protocol : undefined
        }
      />
    </div>
  );
}

const liquidityColumns: Column<LiquidityRow>[] = [
  {
    key: "position",
    header: "Position",
    cell: (row) => {
      if (row.kind === "protoTotal") {
        return (
          <span className="gap-3 inline-flex items-center">
            <Image
              src={PROTOCOL_LOGO[row.protocol]}
              alt={row.protocol}
              width={32}
              height={32}
              className="h-8 w-8 shrink-0"
            />
            <span className="font-medium">
              {row.protocol}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {row.positionCount}{" "}
                {row.positionCount === 1 ? "position" : "positions"}
              </span>
            </span>
          </span>
        );
      }
      if (row.kind === "position") {
        return (
          <span className="gap-2 inline-flex items-center">
            <span className="font-medium">{row.name}</span>
            <span className="rounded px-1.5 py-0.5 font-medium bg-muted text-[10px] text-muted-foreground">
              {chainLabel(row.chain)}
            </span>
          </span>
        );
      }
      if (row.kind === "protoSubtotals") {
        return (
          <span className="text-sm font-medium text-muted-foreground">
            {row.protocol} Breakdown
          </span>
        );
      }
      return <span className="font-semibold">Total</span>;
    },
  },
  {
    key: "mento",
    header: "Mento Stables",
    cell: (row) => {
      if (row.kind === "protoTotal") {
        return (
          <span className="text-lg font-semibold tabular-nums">
            {row.mentoUsd > 0 ? formatUsd(row.mentoUsd) : "—"}
          </span>
        );
      }
      if (row.kind === "position" || row.kind === "protoSubtotals") {
        return <TokenColumn tokens={row.mentoTokens} />;
      }
      return (
        <span className="font-semibold tabular-nums">
          {formatUsd(row.mentoUsd)}
        </span>
      );
    },
  },
  {
    key: "collateral",
    header: "Collateral",
    cell: (row) => {
      if (row.kind === "protoTotal") {
        return (
          <span className="text-lg font-semibold tabular-nums">
            {row.collateralUsd > 0 ? formatUsd(row.collateralUsd) : "—"}
          </span>
        );
      }
      if (row.kind === "position" || row.kind === "protoSubtotals") {
        return <TokenColumn tokens={row.collateralTokens} />;
      }
      return (
        <span className="font-semibold tabular-nums">
          {formatUsd(row.collateralUsd)}
        </span>
      );
    },
  },
  {
    key: "holder",
    header: "Holder",
    cell: (row) => {
      if (row.kind !== "position") return null;
      return (
        <AddressLabel
          variant="compact"
          label={row.holder}
          address={row.holderAddress}
          chain={row.chain}
          description={row.holderDescription}
          context="positions_tab:liquidity_holder"
        />
      );
    },
  },
];

function liquidityRowClassName(row: TreeRow<LiquidityRow>): string {
  if (row.kind === "protoTotal") {
    return `border-l-4 bg-card transition-colors hover:bg-accent ${PROTOCOL_BORDER[row.protocol]}`;
  }
  if (row.kind === "protoSubtotals") {
    return `border-l-4 bg-card ${PROTOCOL_BORDER[row.protocol]}`;
  }
  if (row.kind === "grandLiquidityTotal") {
    return "border-t-2 border-[var(--border)] bg-card";
  }
  return "transition-colors hover:bg-accent";
}

function TokenColumn({ tokens }: { tokens: Token[] }) {
  if (tokens.length === 0)
    return <span className="text-muted-foreground">—</span>;
  return (
    <span className="gap-1 flex flex-col">
      {tokens.map((token, index) => (
        <span
          key={`${token.symbol}-${index}`}
          className="gap-2 flex items-center"
        >
          <Image
            src={`/tokens/${token.symbol}.svg`}
            alt={token.symbol}
            width={16}
            height={16}
            className="h-4 w-4"
            onError={(event) => {
              event.currentTarget.src = "/tokens/CELO.svg";
            }}
          />
          <span className="text-sm tabular-nums">
            {formatNumber(token.amount, 2)} {token.symbol}
          </span>
          {token.usdValue > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              = {formatUsd(token.usdValue)}
            </span>
          )}
        </span>
      ))}
    </span>
  );
}
