"use client";

import Image from "next/image";
import type { V2ReserveResponse, V2StablecoinsResponse } from "@/lib/types";
import { formatUsd, formatNumber, formatPercent } from "@/lib/format";
import { getBlockExplorerUrl, truncateAddress } from "@/lib/format";
import { chainLabel } from "@/lib/chains";
import { InfoTooltip } from "../info-tooltip";
import { TreeTable, type Column, type TreeRow } from "../tree-table";

type Protocol = "AAVE" | "Uniswap V3" | "Mento FPMM" | "Mento Liquity V2";

const PROTOCOL_LOGO: Record<Protocol, string> = {
  AAVE: "/protocols/aave.svg",
  "Uniswap V3": "/protocols/uniswap.svg",
  "Mento FPMM": "/protocols/mento.svg",
  "Mento Liquity V2": "/protocols/mento-liquity.svg",
};

const PROTOCOL_BORDER: Record<Protocol, string> = {
  AAVE: "border-[#9391F7]/60",
  "Uniswap V3": "border-[#FF007A]/60",
  "Mento FPMM": "border-[#7005fc]/60",
  "Mento Liquity V2": "border-[#405AE5]/60",
};

const PROTOCOL_ORDER: Protocol[] = [
  "Mento FPMM",
  "AAVE",
  "Uniswap V3",
  "Mento Liquity V2",
];

type Token = {
  symbol: string;
  amount: number;
  usdValue: number;
  isMentoStable: boolean;
};

type LiquidityPosition = {
  protocol: Protocol;
  positionName: string;
  tokens: Token[];
  holder: string;
  chain: string;
};

export function PositionsTab({
  reserve,
  stablecoins,
}: {
  reserve: V2ReserveResponse;
  stablecoins: V2StablecoinsResponse;
}) {
  const { positions } = reserve;

  const priceMap = buildPriceMap(reserve, stablecoins);
  const mentoSymbols = new Set(stablecoins.stablecoins.map((c) => c.symbol));

  // Trust is_mento_stable but fall back to the canonical stablecoin symbol
  // set in case the backend misses the flag for a known Mento stable.
  const stableHoldings = positions.wallet_balances.filter(
    (b) =>
      (b.is_mento_stable || mentoSymbols.has(b.token)) &&
      parseFloat(b.balance) > 0,
  );

  const liquidityPositions = normalizePositions(
    reserve,
    mentoSymbols,
    priceMap,
  ).filter((p) => p.tokens.some((t) => t.amount > 0));

  // Reserve-held totals come from the API's policy-applied breakdown so the
  // headline matches `overview.supply.reserve_held_usd` exactly. CDP collateral
  // that's committed to servicing debt (debt + wiggleroom) is excluded; only
  // the overhead above that counts as free reserve-held supply.
  const bySource = new Map(
    reserve.reserve_held_supply.by_source.map(
      (s) => [s.type, s.usd_value] as const,
    ),
  );
  const reserveHeldTotal = reserve.reserve_held_supply.total_usd;
  const operationalTotal = bySource.get("wallet") ?? 0;
  const liquidityMentoTotal =
    (bySource.get("aave") ?? 0) +
    (bySource.get("lp") ?? 0) +
    (bySource.get("stability_pool") ?? 0);
  const troveOverheadTotal = bySource.get("cdp_overhead") ?? 0;

  return (
    <div className="gap-12 flex flex-col">
      <ReserveHeldSummary
        total={reserveHeldTotal}
        operational={operationalTotal}
        liquidity={liquidityMentoTotal}
        troveOverhead={troveOverheadTotal}
      />
      {stableHoldings.length > 0 && (
        <OperationalHoldingsSection holdings={stableHoldings} />
      )}
      <LiquidityPositionsSection positions={liquidityPositions} />
      <CdpTrovesSection troves={reserve.cdp_troves} />
    </div>
  );
}

/* ──────────────── Reserve Held Summary ──────────────── */

function ReserveHeldSummary({
  total,
  operational,
  liquidity,
  troveOverhead,
}: {
  total: number;
  operational: number;
  liquidity: number;
  troveOverhead: number;
}) {
  return (
    <div>
      <h2 className="mb-6 text-2xl font-medium">Reserve Held Breakdown</h2>
      {/* Desktop */}
      <div className="md:flex md:items-center md:gap-3 hidden">
        <SummaryCard
          label="Total Reserve Held"
          value={formatUsd(total)}
          tooltip="Sum of balances counted toward reserve-held supply in operational wallets, liquidity positions, and CDP trove overhead. Not counted as reserve liabilities."
          className="flex-1"
        />
        <SummaryOp>=</SummaryOp>
        <SummaryCard
          label="Operational"
          value={formatUsd(operational)}
          tooltip="Mento stablecoins held directly in reserve wallets."
          className="flex-1"
        />
        <SummaryOp>+</SummaryOp>
        <SummaryCard
          label="Liquidity Positions"
          value={formatUsd(liquidity)}
          tooltip="Mento stablecoins held in LP positions across AAVE, Uniswap V3, Mento FPMM, and Liquity V2."
          className="flex-1"
        />
        <SummaryOp>+</SummaryOp>
        <SummaryCard
          label="Trove Overhead"
          value={formatUsd(troveOverhead)}
          tooltip="The portion of CDP collateral left after reserving enough capital to repay the debt plus a wiggle-room buffer. Hover the overhead column on a specific trove to see the calculation."
          className="flex-1"
        />
      </div>

      {/* Mobile */}
      <div className="gap-2 md:hidden flex flex-col">
        <SummaryCard
          label="Total Reserve Held"
          value={formatUsd(total)}
          tooltip="Sum of balances counted toward reserve-held supply in operational wallets, liquidity positions, and CDP trove overhead."
        />
        <SummaryOp>=</SummaryOp>
        <div className="gap-2 grid grid-cols-3">
          <SummaryCard
            label="Operational"
            value={formatUsd(operational, true)}
            tooltip="Mento stablecoins held directly in reserve wallets."
          />
          <SummaryCard
            label="Liquidity"
            value={formatUsd(liquidity, true)}
            tooltip="Mento stablecoins held in LP positions across AAVE, Uniswap V3, Mento FPMM, and Liquity V2."
          />
          <SummaryCard
            label="Overhead"
            value={formatUsd(troveOverhead, true)}
            tooltip="The portion of CDP collateral left after reserving enough capital to repay the debt plus a wiggle-room buffer."
          />
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tooltip,
  className,
}: {
  label: string;
  value: string;
  tooltip?: string;
  className?: string;
}) {
  return (
    <div className={`p-4 md:p-6 bg-card ${className ?? ""}`}>
      <span className="text-sm gap-1 flex items-center text-muted-foreground">
        {label}
        {tooltip && <InfoTooltip>{tooltip}</InfoTooltip>}
      </span>
      <p className="mt-1 text-xl font-medium md:text-2xl">{value}</p>
    </div>
  );
}

function SummaryOp({ children }: { children: string }) {
  return (
    <span className="text-lg font-light shrink-0 text-center text-muted-foreground">
      {children}
    </span>
  );
}

/* ──────────────── Operational Holdings (TreeTable) ──────────────── */

type HoldingEntry = V2ReserveResponse["positions"]["wallet_balances"][number];

type OpAssetRow = {
  kind: "opAsset";
  symbol: string;
  balance: number;
  usd: number;
  pct: number;
};
type OpCustodyRow = {
  kind: "opCustody";
  chain: string;
  label: string;
  address: string;
  balance: string;
  usd: number;
};
type OpTotalRow = {
  kind: "opTotal";
  usd: number;
};
type OpRow = OpAssetRow | OpCustodyRow | OpTotalRow;

function OperationalHoldingsSection({
  holdings,
}: {
  holdings: HoldingEntry[];
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
  for (const h of holdings) {
    let group = grouped.get(h.token);
    if (!group) {
      group = {
        symbol: h.token,
        totalBalance: 0,
        totalUsd: 0,
        custodies: [],
      };
      grouped.set(h.token, group);
    }
    group.totalBalance += parseFloat(h.balance);
    group.totalUsd += h.usd_value;
    group.custodies.push(h);
  }

  const assets = [...grouped.values()].sort((a, b) => b.totalUsd - a.totalUsd);
  const totalUsd = assets.reduce((s, a) => s + a.totalUsd, 0);

  const rows: TreeRow<OpRow>[] = assets.map((asset) => ({
    id: `op:${asset.symbol}`,
    kind: "opAsset",
    symbol: asset.symbol,
    balance: asset.totalBalance,
    usd: asset.totalUsd,
    pct: totalUsd > 0 ? (asset.totalUsd / totalUsd) * 100 : 0,
    // Only attach children when there's a meaningful breakdown to show.
    children:
      asset.custodies.length > 1
        ? asset.custodies.map<TreeRow<OpRow>>((c, i) => ({
            id: `op:${asset.symbol}:${c.address}:${c.chain}:${i}`,
            kind: "opCustody",
            chain: c.chain,
            label: c.label,
            address: c.address,
            balance: c.balance,
            usd: c.usd_value,
          }))
        : undefined,
  }));

  rows.push({
    id: "op:total",
    kind: "opTotal",
    usd: totalUsd,
  });

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
              onError={(e) => {
                e.currentTarget.src = "/tokens/CELO.svg";
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
            <span className="text-sm text-muted-foreground">{row.label}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {truncateAddress(row.address)}
            </span>
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
      if (row.kind === "opCustody")
        return (
          <span className="text-sm text-muted-foreground">
            {formatNumber(row.balance, 2)}
          </span>
        );
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
      if (row.kind === "opCustody")
        return (
          <span className="text-sm text-muted-foreground">
            {formatUsd(row.usd)}
          </span>
        );
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

/* ──────────────── Liquidity Positions (TreeTable) ──────────────── */

type ProtocolTotalRowData = {
  kind: "protoTotal";
  protocol: Protocol;
  mentoUsd: number;
  collateralUsd: number;
  positionCount: number;
};
type PositionRowData = {
  kind: "position";
  protocol: Protocol;
  name: string;
  chain: string;
  holder: string;
  mentoTokens: Token[];
  collateralTokens: Token[];
};
type ProtocolSubtotalsRowData = {
  kind: "protoSubtotals";
  protocol: Protocol;
  mentoTokens: Token[];
  collateralTokens: Token[];
};
type GrandLiquidityTotalRowData = {
  kind: "grandLiquidityTotal";
  mentoUsd: number;
  collateralUsd: number;
};
type LiquidityRow =
  | ProtocolTotalRowData
  | PositionRowData
  | ProtocolSubtotalsRowData
  | GrandLiquidityTotalRowData;

function LiquidityPositionsSection({
  positions,
}: {
  positions: LiquidityPosition[];
}) {
  const byProtocol = new Map<Protocol, LiquidityPosition[]>();
  for (const p of positions) {
    if (!byProtocol.has(p.protocol)) byProtocol.set(p.protocol, []);
    byProtocol.get(p.protocol)!.push(p);
  }

  const rows: TreeRow<LiquidityRow>[] = [];
  let grandMentoUsd = 0;
  let grandCollUsd = 0;

  for (const protocol of PROTOCOL_ORDER) {
    const items = byProtocol.get(protocol);
    if (!items || items.length === 0) continue;

    const mentoUsd = sumUsd(items, (t) => t.isMentoStable);
    const collateralUsd = sumUsd(items, (t) => !t.isMentoStable);
    const aggregated = aggregateTokens(items);
    const mentoTokens = sortTokensBySymbol(
      aggregated.filter((t) => t.isMentoStable),
    );
    const collateralTokens = sortTokensBySymbol(
      aggregated.filter((t) => !t.isMentoStable),
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
      children: items.map<TreeRow<LiquidityRow>>((pos, i) => {
        const nonZero = pos.tokens.filter((t) => t.amount > 0);
        return {
          id: `liq:${protocol}:pos:${pos.positionName}:${i}`,
          kind: "position",
          protocol,
          name: pos.positionName,
          chain: pos.chain,
          holder: pos.holder,
          mentoTokens: sortTokensBySymbol(
            nonZero.filter((t) => t.isMentoStable),
          ),
          collateralTokens: sortTokensBySymbol(
            nonZero.filter((t) => !t.isMentoStable),
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
      if (row.kind === "position")
        return <TokenColumn tokens={row.mentoTokens} />;
      if (row.kind === "protoSubtotals")
        return <TokenColumn tokens={row.mentoTokens} />;
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
      if (row.kind === "position")
        return <TokenColumn tokens={row.collateralTokens} />;
      if (row.kind === "protoSubtotals")
        return <TokenColumn tokens={row.collateralTokens} />;
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
      if (row.kind === "position")
        return (
          <span className="text-sm text-muted-foreground">{row.holder}</span>
        );
      return null;
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
  if (tokens.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="gap-1 flex flex-col">
      {tokens.map((t, i) => (
        <span key={`${t.symbol}-${i}`} className="gap-2 flex items-center">
          <Image
            src={`/tokens/${t.symbol}.svg`}
            alt={t.symbol}
            width={16}
            height={16}
            className="h-4 w-4"
            onError={(e) => {
              e.currentTarget.src = "/tokens/CELO.svg";
            }}
          />
          <span className="text-sm tabular-nums">
            {formatNumber(t.amount, 2)} {t.symbol}
          </span>
          {t.usdValue > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              = {formatUsd(t.usdValue)}
            </span>
          )}
        </span>
      ))}
    </span>
  );
}

function sumUsd(
  positions: LiquidityPosition[],
  pred: (t: Token) => boolean,
): number {
  return positions.reduce(
    (s, p) => s + p.tokens.filter(pred).reduce((ss, t) => ss + t.usdValue, 0),
    0,
  );
}

// Stable, case-insensitive sort by symbol so breakdown rows line up
// identically regardless of the underlying position order.
function sortTokensBySymbol(tokens: Token[]): Token[] {
  return [...tokens].sort((a, b) =>
    a.symbol.toLowerCase().localeCompare(b.symbol.toLowerCase()),
  );
}

function aggregateTokens(positions: LiquidityPosition[]): Token[] {
  const map = new Map<string, Token>();
  for (const p of positions) {
    for (const t of p.tokens) {
      if (t.amount === 0) continue;
      const existing = map.get(t.symbol);
      if (existing) {
        existing.amount += t.amount;
        existing.usdValue += t.usdValue;
      } else {
        map.set(t.symbol, { ...t });
      }
    }
  }
  return [...map.values()].sort((a, b) => b.usdValue - a.usdValue);
}

/* ──────────────── Price Map & Normalization ──────────────── */

function buildPriceMap(
  reserve: V2ReserveResponse,
  stablecoins: V2StablecoinsResponse,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const coin of stablecoins.stablecoins) {
    const total = parseFloat(coin.supply.total);
    if (total > 0) map.set(coin.symbol, coin.supply.total_usd / total);
  }
  for (const asset of reserve.collateral.assets) {
    const balance = parseFloat(asset.balance);
    if (balance > 0 && asset.usd_value > 0 && !map.has(asset.symbol)) {
      map.set(asset.symbol, asset.usd_value / balance);
    }
  }
  for (const sym of ["USDC", "USDT", "USDGLO", "AUSD", "DAI", "axlUSDC"]) {
    if (!map.has(sym)) map.set(sym, 1);
  }
  return map;
}

function priceOf(
  symbol: string,
  amount: number,
  priceMap: Map<string, number>,
): number {
  const rate = priceMap.get(symbol);
  if (rate === undefined) return 0;
  return rate * amount;
}

function normalizePositions(
  reserve: V2ReserveResponse,
  mentoSymbols: Set<string>,
  priceMap: Map<string, number>,
): LiquidityPosition[] {
  const { positions } = reserve;
  const out: LiquidityPosition[] = [];

  for (const d of positions.aave_deposits) {
    const amount = parseFloat(d.balance);
    const usd =
      d.usd_value > 0 ? d.usd_value : priceOf(d.token, amount, priceMap);
    out.push({
      protocol: "AAVE",
      positionName: `${d.token} Deposit`,
      tokens: [
        {
          symbol: d.token,
          amount,
          usdValue: usd,
          isMentoStable: d.is_mento_stable || mentoSymbols.has(d.token),
        },
      ],
      holder: d.label,
      chain: d.chain,
    });
  }

  for (const p of positions.fpmm_positions) {
    const debtAmt = p.debt_token.amount;
    const collAmt = p.collateral_token.amount;
    out.push({
      protocol: "Mento FPMM",
      positionName: p.pool_name,
      tokens: [
        {
          symbol: p.debt_token.symbol,
          amount: debtAmt,
          usdValue: priceOf(p.debt_token.symbol, debtAmt, priceMap),
          isMentoStable: mentoSymbols.has(p.debt_token.symbol),
        },
        {
          symbol: p.collateral_token.symbol,
          amount: collAmt,
          usdValue: priceOf(p.collateral_token.symbol, collAmt, priceMap),
          isMentoStable: mentoSymbols.has(p.collateral_token.symbol),
        },
      ],
      holder: p.lp_holder_label,
      chain: p.chain,
    });
  }

  for (const p of positions.univ3_positions) {
    const amt0 = parseFloat(p.token0.amount);
    const amt1 = parseFloat(p.token1.amount);
    out.push({
      protocol: "Uniswap V3",
      positionName: `${p.token0.symbol} / ${p.token1.symbol}`,
      tokens: [
        {
          symbol: p.token0.symbol,
          amount: amt0,
          usdValue: priceOf(p.token0.symbol, amt0, priceMap),
          isMentoStable: mentoSymbols.has(p.token0.symbol),
        },
        {
          symbol: p.token1.symbol,
          amount: amt1,
          usdValue: priceOf(p.token1.symbol, amt1, priceMap),
          isMentoStable: mentoSymbols.has(p.token1.symbol),
        },
      ],
      holder: p.owner_label,
      chain: p.chain,
    });
  }

  for (const d of positions.stability_pool_deposits) {
    const tokens: Token[] = [
      {
        symbol: d.deposit_token,
        amount: parseFloat(d.deposit_amount),
        usdValue: d.deposit_usd,
        isMentoStable: mentoSymbols.has(d.deposit_token),
      },
    ];
    const collAmount = parseFloat(d.collateral_gained);
    if (collAmount > 0) {
      tokens.push({
        symbol: d.collateral_gained_token,
        amount: collAmount,
        usdValue: d.collateral_gained_usd,
        isMentoStable: mentoSymbols.has(d.collateral_gained_token),
      });
    }
    out.push({
      protocol: "Mento Liquity V2",
      positionName: d.pool_label,
      tokens,
      holder: d.depositor_label,
      chain: d.chain,
    });
  }

  return out;
}

/* ──────────────── CDP Trove Positions ──────────────── */

function CdpTrovesSection({
  troves,
}: {
  troves: V2ReserveResponse["cdp_troves"];
}) {
  const activeTroves = troves.troves.filter((t) => t.status === "active");
  const totalCollateral = activeTroves.reduce(
    (s, t) => s + t.collateral_usd,
    0,
  );
  const totalDebt = activeTroves.reduce((s, t) => s + t.debt_usd, 0);
  const totalOverhead = activeTroves.reduce(
    (s, t) => s + (t.overhead?.usd ?? 0),
    0,
  );

  return (
    <div>
      <h2 className="mb-2 text-2xl font-medium">CDP Trove Positions</h2>
      <p className="mb-6 max-w-xl text-sm text-muted-foreground">
        Active collateralized debt positions. Collateral deposited in CDPs backs
        the minted stablecoins. The overhead is the excess collateral that is
        left after reserving enough capital to repay the debt plus a wiggle-room
        buffer, and is not counted as a reserve liability.
      </p>

      <div className="overflow-x-auto">
        <table className="text-base w-full min-w-[900px]">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Trove</th>
              <th className="px-4 py-3 font-medium">Owner</th>
              <th className="px-4 py-3 font-medium text-right">Collateral</th>
              <th className="px-4 py-3 font-medium text-right">Debt</th>
              <th className="px-4 py-3 font-medium text-right">Ratio</th>
              <th className="px-4 py-3 font-medium text-right">Interest</th>
              <th className="px-4 py-3 font-medium text-right">
                <div className="gap-1 flex items-center justify-end">
                  Overhead
                  <InfoTooltip>
                    The portion of CDP collateral left after reserving enough
                    capital to repay the debt plus a wiggle-room buffer. Counted
                    as reserve-held, not a liability.
                  </InfoTooltip>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {activeTroves.map((trove) => (
              <TroveRow key={trove.trove_id} trove={trove} />
            ))}

            <tr className="border-t-2 border-[var(--border)] bg-card">
              <td colSpan={2} className="px-4 py-3 font-medium">
                {activeTroves.length} active troves
              </td>
              <td className="px-4 py-3 font-medium text-right tabular-nums">
                {formatUsd(totalCollateral)}
              </td>
              <td className="px-4 py-3 font-medium text-right tabular-nums">
                {formatUsd(totalDebt)}
              </td>
              <td className="px-4 py-3" />
              <td className="px-4 py-3" />
              <td className="px-4 py-3 font-medium text-right tabular-nums">
                {formatUsd(totalOverhead)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TroveRow({
  trove,
}: {
  trove: V2ReserveResponse["cdp_troves"]["troves"][number];
}) {
  return (
    <tr className="border-b border-[var(--border)] hover:bg-accent">
      <td className="px-4 py-3">
        <div className="gap-3 flex items-center">
          <Image
            src={`/tokens/${trove.stablecoin}.svg`}
            alt={trove.stablecoin}
            width={28}
            height={28}
            className="h-7 w-7"
            onError={(e) => {
              e.currentTarget.src = "/tokens/CELO.svg";
            }}
          />
          <div className="gap-2 flex items-center">
            <span className="font-medium">{trove.stablecoin}</span>
            <span className="rounded px-1.5 py-0.5 font-medium bg-muted text-[10px] text-muted-foreground">
              {chainLabel(trove.chain)}
            </span>
            <a
              href={getBlockExplorerUrl(trove.chain, trove.contract_address)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[#8c35fd] underline transition-colors hover:text-[#a855f7]"
            >
              View
            </a>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {trove.owner_label}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        <div>{formatUsd(trove.collateral_usd)}</div>
        <div className="text-xs text-muted-foreground">
          {formatNumber(trove.collateral_amount, 2)} {trove.collateral_token}
        </div>
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        <div>{formatUsd(trove.debt_usd)}</div>
        <div className="text-xs text-muted-foreground">
          {formatNumber(trove.debt_amount, 2)} {trove.stablecoin}
        </div>
      </td>
      <td className="px-4 py-3 text-green-400 text-right tabular-nums">
        {trove.ratio.toFixed(2)}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {(trove.annual_interest_rate * 100).toFixed(1)}%
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {trove.overhead ? (
          <div className="gap-1 inline-flex items-center">
            {formatUsd(trove.overhead.usd)}
            <InfoTooltip>
              max(0, {formatUsd(trove.collateral_usd)} − (
              {formatUsd(trove.debt_usd)}× (1 + {trove.overhead.wiggleroom_pct}
              %))) = {formatUsd(trove.overhead.usd)}
            </InfoTooltip>
          </div>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}
