"use client";

import { useState } from "react";
import Image from "next/image";
import { IconInfo } from "@repo/ui";
import { Tooltip, TooltipTrigger, TooltipContent } from "@repo/ui";
import type { V2ReserveResponse, V2StablecoinsResponse } from "@/lib/types";
import { formatUsd, formatNumber, formatPercent } from "@/lib/format";
import { getBlockExplorerUrl, truncateAddress } from "@/lib/format";

const chainLabel = (chain: string) => {
  const labels: Record<string, string> = {
    celo: "Celo",
    ethereum: "Ethereum",
    monad: "Monad",
    bitcoin: "Bitcoin",
  };
  return labels[chain] ?? chain;
};

type Protocol = "AAVE" | "Uniswap V3" | "Mento FPMM" | "Mento Liquity V2";

const PROTOCOL_LOGO: Record<Protocol, string> = {
  AAVE: "/protocols/aave.svg",
  "Uniswap V3": "/protocols/uniswap.svg",
  "Mento FPMM": "/protocols/mento.svg",
  "Mento Liquity V2": "/protocols/mento-liquity.svg",
};

const PROTOCOL_LOGO_WIDTH: Record<Protocol, number> = {
  AAVE: 32,
  "Uniswap V3": 32,
  "Mento FPMM": 32,
  "Mento Liquity V2": 32,
};

const PROTOCOL_BORDER: Record<Protocol, string> = {
  AAVE: "border-[#9391F7]/60",
  "Uniswap V3": "border-[#FF007A]/60",
  "Mento FPMM": "border-[#7005fc]/60",
  "Mento Liquity V2": "border-[#405AE5]/60",
};

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

  // Build price map (USD per unit) from all known sources
  const priceMap = buildPriceMap(reserve, stablecoins);
  const mentoSymbols = new Set(stablecoins.stablecoins.map((c) => c.symbol));

  const stableHoldings = positions.wallet_balances.filter(
    (b) => b.is_mento_stable && parseFloat(b.balance) > 0,
  );

  const liquidityPositions = normalizePositions(
    reserve,
    mentoSymbols,
    priceMap,
  ).filter((p) => p.tokens.some((t) => t.amount > 0));

  // Compute the reserve-held totals for the summary header
  const operationalTotal = stableHoldings.reduce((s, h) => s + h.usd_value, 0);
  const liquidityMentoTotal = liquidityPositions.reduce(
    (s, p) =>
      s +
      p.tokens
        .filter((t) => t.isMentoStable)
        .reduce((ss, t) => ss + t.usdValue, 0),
    0,
  );
  const troveOverheadTotal = reserve.cdp_troves.troves
    .filter((t) => t.status === "active")
    .reduce((s, t) => s + (t.overhead?.usd ?? 0), 0);
  const reserveHeldTotal =
    operationalTotal + liquidityMentoTotal + troveOverheadTotal;

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
          tooltip="Sum of Mento stablecoins held by the reserve in operational wallets, liquidity positions, and CDP trove overhead. Not counted as reserve liabilities."
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
          tooltip="The portion of CDP collateral that sits above the debt plus a wiggle-room buffer. Hover the overhead column on a specific trove to see the calculation."
          className="flex-1"
        />
      </div>

      {/* Mobile */}
      <div className="gap-2 md:hidden flex flex-col">
        <SummaryCard
          label="Total Reserve Held"
          value={formatUsd(total)}
          tooltip="Sum of Mento stablecoins held by the reserve in operational wallets, liquidity positions, and CDP trove overhead."
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
            tooltip="The portion of CDP collateral that sits above the debt plus a wiggle-room buffer."
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

function InfoTooltip({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger className="flex items-center">
        <IconInfo />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs" hideArrow>
        <p>{children}</p>
      </TooltipContent>
    </Tooltip>
  );
}

/* ──────────────── Price Map & Normalization ──────────────── */

function buildPriceMap(
  reserve: V2ReserveResponse,
  stablecoins: V2StablecoinsResponse,
): Map<string, number> {
  const map = new Map<string, number>();

  // From stablecoins: rate = total_usd / total
  for (const coin of stablecoins.stablecoins) {
    const total = parseFloat(coin.supply.total);
    if (total > 0) {
      map.set(coin.symbol, coin.supply.total_usd / total);
    }
  }

  // From collateral: rate = usd_value / balance
  for (const asset of reserve.collateral.assets) {
    const balance = parseFloat(asset.balance);
    if (balance > 0 && asset.usd_value > 0 && !map.has(asset.symbol)) {
      map.set(asset.symbol, asset.usd_value / balance);
    }
  }

  // Known 1:1 stables as fallback
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

  // AAVE
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

  // FPMM
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

  // Uniswap V3
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

  // Stability Pool
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

/* ──────────────── Operational Stablecoin Holdings ──────────────── */

type HoldingEntry = V2ReserveResponse["positions"]["wallet_balances"][number];

type AssetGroup = {
  symbol: string;
  totalBalance: number;
  totalUsd: number;
  custodies: HoldingEntry[];
};

function OperationalHoldingsSection({
  holdings,
}: {
  holdings: HoldingEntry[];
}) {
  // Group by asset symbol
  const grouped = new Map<string, AssetGroup>();
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

  return (
    <div>
      <h2 className="mb-2 text-2xl font-medium">Operational Holdings</h2>
      <p className="mb-6 max-w-xl text-sm text-muted-foreground">
        Mento stablecoins held directly in reserve wallets. Not counted as
        reserve liabilities.
      </p>

      <div className="overflow-x-auto">
        <table className="text-base w-full min-w-[600px] table-fixed">
          <colgroup>
            <col className="w-[40%]" />
            <col className="w-[20%]" />
            <col className="w-[25%]" />
            <col className="w-[15%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Asset</th>
              <th className="px-4 py-3 font-medium text-right">Amount</th>
              <th className="px-4 py-3 font-medium text-right">Value (USD)</th>
              <th className="px-4 py-3 font-medium text-right">%</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => (
              <HoldingAssetRow
                key={asset.symbol}
                asset={asset}
                totalUsd={totalUsd}
              />
            ))}

            {/* Grand total */}
            <tr className="border-t border-[var(--border)] bg-card">
              <td className="px-4 py-3 font-medium">Total</td>
              <td className="px-4 py-3" />
              <td className="px-4 py-3 font-medium text-right tabular-nums">
                {formatUsd(totalUsd)}
              </td>
              <td className="px-4 py-3 font-medium text-right tabular-nums">
                100%
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HoldingAssetRow({
  asset,
  totalUsd,
}: {
  asset: AssetGroup;
  totalUsd: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasMultiple = asset.custodies.length > 1;
  const pct = totalUsd > 0 ? (asset.totalUsd / totalUsd) * 100 : 0;

  return (
    <>
      <tr
        className={`border-b border-[var(--border)] transition-colors hover:bg-accent ${hasMultiple ? "cursor-pointer" : ""}`}
        onClick={() => hasMultiple && setExpanded(!expanded)}
      >
        <td className="px-4 py-3">
          <div className="gap-3 flex items-center">
            {hasMultiple && (
              <span
                className={`text-xs text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
              >
                ▶
              </span>
            )}
            <Image
              src={`/tokens/${asset.symbol}.svg`}
              alt={asset.symbol}
              width={28}
              height={28}
              className="h-7 w-7"
              onError={(e) => {
                e.currentTarget.src = "/tokens/CELO.svg";
              }}
            />
            <span className="font-medium">{asset.symbol}</span>
          </div>
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          {formatNumber(asset.totalBalance, 2)}
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          {formatUsd(asset.totalUsd)}
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          {formatPercent(pct)}
        </td>
      </tr>

      {/* Custody breakdown */}
      {expanded &&
        asset.custodies.map((c, i) => (
          <tr
            key={`${c.address}-${c.chain}-${i}`}
            className="border-b border-[var(--border)] bg-[#15111b]/50"
          >
            <td className="px-4 py-2 pl-16">
              <div className="gap-2 flex items-center">
                <span className="rounded px-1.5 py-0.5 font-medium bg-muted text-[10px] text-muted-foreground">
                  {chainLabel(c.chain)}
                </span>
                <span className="text-sm text-muted-foreground">{c.label}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {truncateAddress(c.address)}
                </span>
              </div>
            </td>
            <td className="px-4 py-2 text-sm text-right text-muted-foreground tabular-nums">
              {formatNumber(c.balance, 2)}
            </td>
            <td className="px-4 py-2 text-sm text-right text-muted-foreground tabular-nums">
              {formatUsd(c.usd_value)}
            </td>
            <td className="px-4 py-2" />
          </tr>
        ))}
    </>
  );
}

/* ──────────────── Liquidity Positions (unified) ──────────────── */

function LiquidityPositionsSection({
  positions,
}: {
  positions: LiquidityPosition[];
}) {
  // Group by protocol
  const byProtocol = new Map<Protocol, LiquidityPosition[]>();
  for (const p of positions) {
    if (!byProtocol.has(p.protocol)) byProtocol.set(p.protocol, []);
    byProtocol.get(p.protocol)!.push(p);
  }

  // Order: Mento FPMM, AAVE, Uniswap V3, Mento Liquity V2
  const protocolOrder: Protocol[] = [
    "Mento FPMM",
    "AAVE",
    "Uniswap V3",
    "Mento Liquity V2",
  ];

  // Totals
  const sumMento = (ps: LiquidityPosition[]) =>
    ps.reduce(
      (s, p) =>
        s +
        p.tokens
          .filter((t) => t.isMentoStable)
          .reduce((ss, t) => ss + t.usdValue, 0),
      0,
    );
  const sumCollateral = (ps: LiquidityPosition[]) =>
    ps.reduce(
      (s, p) =>
        s +
        p.tokens
          .filter((t) => !t.isMentoStable)
          .reduce((ss, t) => ss + t.usdValue, 0),
      0,
    );

  const grandMento = sumMento(positions);
  const grandColl = sumCollateral(positions);
  const grandAggregated = aggregateTokens(positions);
  const grandMentoAgg = grandAggregated.filter((t) => t.isMentoStable);
  const grandCollAgg = grandAggregated.filter((t) => !t.isMentoStable);

  return (
    <div>
      <h2 className="mb-2 text-2xl font-medium">Liquidity Positions</h2>
      <p className="mb-6 max-w-xl text-sm text-muted-foreground">
        Reserve-held positions across AAVE, Uniswap V3, Mento FPMM pools, and
        Liquity V2 stability pools.
      </p>

      <div className="overflow-x-auto">
        <table className="text-base w-full min-w-[900px]">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Position</th>
              <th className="px-4 py-3 font-medium">Mento Stables</th>
              <th className="px-4 py-3 font-medium">Collateral</th>
              <th className="px-4 py-3 font-medium">Holder</th>
            </tr>
          </thead>
          <tbody>
            {protocolOrder.map((protocol) => {
              const items = byProtocol.get(protocol) ?? [];
              if (items.length === 0) return null;
              return (
                <ProtocolGroup
                  key={protocol}
                  protocol={protocol}
                  items={items}
                  totalMento={sumMento(items)}
                  totalCollateral={sumCollateral(items)}
                />
              );
            })}

            {/* Grand breakdown — aggregated per-asset across all protocols */}
            <tr className="border-t-2 border-[var(--border)] bg-card">
              <td className="px-4 pt-3 pb-1 text-sm font-medium text-muted-foreground">
                Grand Breakdown
              </td>
              <td className="px-4 pt-3 pb-1">
                <TokenColumn tokens={grandMentoAgg} />
              </td>
              <td className="px-4 pt-3 pb-1">
                <TokenColumn tokens={grandCollAgg} />
              </td>
              <td className="px-4 pt-3 pb-1" />
            </tr>

            {/* Grand total USD row */}
            <tr className="bg-card">
              <td className="px-4 pt-1 pb-3 font-semibold">Total</td>
              <td className="px-4 pt-1 pb-3 font-semibold tabular-nums">
                {formatUsd(grandMento)}
              </td>
              <td className="px-4 pt-1 pb-3 font-semibold tabular-nums">
                {formatUsd(grandColl)}
              </td>
              <td className="px-4 pt-1 pb-3" />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProtocolGroup({
  protocol,
  items,
  totalMento,
  totalCollateral,
}: {
  protocol: Protocol;
  items: LiquidityPosition[];
  totalMento: number;
  totalCollateral: number;
}) {
  const aggregated = aggregateTokens(items);
  const mentoAgg = aggregated.filter((t) => t.isMentoStable);
  const collAgg = aggregated.filter((t) => !t.isMentoStable);

  return (
    <>
      {/* Position rows */}
      {items.map((pos, i) => (
        <PositionRow key={`${pos.positionName}-${i}`} pos={pos} />
      ))}

      {/* Protocol subtotal — aggregated per-asset breakdown */}
      <tr className={`border-l-4 bg-card ${PROTOCOL_BORDER[protocol]}`}>
        <td className="px-4 pt-3 pb-1 text-sm font-medium text-muted-foreground">
          {protocol} Breakdown
        </td>
        <td className="px-4 pt-3 pb-1">
          <TokenColumn tokens={mentoAgg} />
        </td>
        <td className="px-4 pt-3 pb-1">
          <TokenColumn tokens={collAgg} />
        </td>
        <td className="px-4 pt-3 pb-1" />
      </tr>

      {/* Protocol total USD row */}
      <tr
        className={`border-b border-l-4 border-[var(--border)] bg-card ${PROTOCOL_BORDER[protocol]}`}
      >
        <td className="px-4 pt-1 pb-3 text-sm font-semibold">
          {protocol} Total
        </td>
        <td className="px-4 pt-1 pb-3 text-sm font-semibold tabular-nums">
          {totalMento > 0 ? formatUsd(totalMento) : "—"}
        </td>
        <td className="px-4 pt-1 pb-3 text-sm font-semibold tabular-nums">
          {totalCollateral > 0 ? formatUsd(totalCollateral) : "—"}
        </td>
        <td className="px-4 pt-1 pb-3" />
      </tr>
    </>
  );
}

function PositionRow({ pos }: { pos: LiquidityPosition }) {
  const nonZero = pos.tokens.filter((t) => t.amount > 0);
  const mentoTokens = nonZero.filter((t) => t.isMentoStable);
  const collTokens = nonZero.filter((t) => !t.isMentoStable);

  return (
    <tr className="border-b border-[var(--border)] hover:bg-accent">
      <td className="px-4 py-3">
        <div className="gap-3 flex items-center">
          <Image
            src={PROTOCOL_LOGO[pos.protocol]}
            alt={pos.protocol}
            width={PROTOCOL_LOGO_WIDTH[pos.protocol]}
            height={32}
            className="h-8 w-8 shrink-0"
          />
          <div>
            <div className="gap-2 flex items-center">
              <span className="font-medium">{pos.positionName}</span>
              <span className="rounded px-1.5 py-0.5 font-medium bg-muted text-[10px] text-muted-foreground">
                {chainLabel(pos.chain)}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">{pos.protocol}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <TokenColumn tokens={mentoTokens} />
      </td>
      <td className="px-4 py-3">
        <TokenColumn tokens={collTokens} />
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">{pos.holder}</td>
    </tr>
  );
}

function TokenColumn({ tokens }: { tokens: Token[] }) {
  if (tokens.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div className="gap-1 flex flex-col">
      {tokens.map((t, i) => (
        <div key={`${t.symbol}-${i}`} className="gap-2 flex items-center">
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
        </div>
      ))}
    </div>
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
        not counted as a reserve liability.
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
                    The portion of CDP collateral that sits above the debt plus
                    a wiggle-room buffer. Counted as reserve-held, not a
                    liability.
                  </InfoTooltip>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {activeTroves.map((trove) => (
              <TroveRow key={trove.trove_id} trove={trove} />
            ))}

            {/* Grand total */}
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
              ({formatUsd(trove.collateral_usd)} − {formatUsd(trove.debt_usd)})
              × (1 − {trove.overhead.wiggleroom_pct}%) ={" "}
              {formatUsd(trove.overhead.usd)}
            </InfoTooltip>
          </div>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}
