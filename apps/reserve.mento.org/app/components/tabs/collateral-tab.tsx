"use client";

import { useState } from "react";
import type { ChartSegment } from "@repo/ui";
import { ReserveChart } from "@repo/ui";
import Image from "next/image";
import type { V2ReserveResponse, Chain } from "@/lib/types";
import { formatUsd, formatNumber, formatPercent, truncateAddress } from "@/lib/format";

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

export function CollateralTab({
  reserve,
}: {
  reserve: V2ReserveResponse;
}) {
  const [active, setActive] = useState<string>();
  const { assets, total_usd } = reserve.collateral;

  // Filter out zero-value dust
  const meaningful = assets.filter((a) => a.usd_value >= 1);
  const sorted = [...meaningful].sort((a, b) => b.usd_value - a.usd_value);

  // Deduplicate chart data by symbol (aggregate across chains)
  const chartBySymbol = new Map<string, number>();
  for (const a of sorted) {
    chartBySymbol.set(a.symbol, (chartBySymbol.get(a.symbol) ?? 0) + a.percentage);
  }
  const chartData: ChartSegment[] = [...chartBySymbol.entries()].map(
    ([symbol, pct]) => ({
      name: symbol,
      value: pct,
      color: getTokenColor(symbol),
    }),
  );

  const largestAsset = sorted[0];
  const centerText = largestAsset
    ? `${largestAsset.percentage.toFixed(2)}%`
    : "Reserve";

  // Group assets by chain
  const byChain = new Map<string, typeof sorted>();
  for (const a of sorted) {
    const chain = a.chain;
    if (!byChain.has(chain)) byChain.set(chain, []);
    byChain.get(chain)!.push(a);
  }

  // Order chains by total value
  const chainOrder = [...byChain.entries()]
    .map(([chain, items]) => ({
      chain,
      items,
      total: items.reduce((s, a) => s + a.usd_value, 0),
      pct: items.reduce((s, a) => s + a.percentage, 0),
    }))
    .sort((a, b) => b.total - a.total);

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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-base table-fixed">
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
                {chainOrder.map((group) => (
                  <ChainGroup
                    key={group.chain}
                    chain={group.chain as Chain}
                    assets={group.items}
                    totalUsd={group.total}
                    totalPct={group.pct}
                    active={active}
                    onHover={setActive}
                  />
                ))}

                {/* Grand total */}
                <tr className="bg-card border-t border-[var(--border)]">
                  <td className="px-4 py-3 font-medium">Total</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-right font-medium tabular-nums">
                    {formatUsd(total_usd)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">
                    100%
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChainGroup({
  chain,
  assets,
  totalUsd,
  totalPct,
  active,
  onHover,
}: {
  chain: Chain;
  assets: V2ReserveResponse["collateral"]["assets"];
  totalUsd: number;
  totalPct: number;
  active: string | undefined;
  onHover: (name: string | undefined) => void;
}) {
  return (
    <>
      {/* Chain header */}
      <tr className="bg-card/50">
        <td colSpan={4} className="px-4 py-2">
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {CHAIN_LABEL[chain] ?? chain}
          </span>
        </td>
      </tr>

      {/* Asset rows */}
      {assets.map((asset) => (
        <AssetRow
          key={`${asset.symbol}-${asset.chain}`}
          asset={asset}
          active={active}
          onHover={onHover}
        />
      ))}

      {/* Chain subtotal */}
      <tr className="border-b border-[var(--border)] bg-card">
        <td className="px-4 py-2 text-sm font-medium text-muted-foreground">
          {CHAIN_LABEL[chain] ?? chain} Total
        </td>
        <td className="px-4 py-2" />
        <td className="px-4 py-2 text-right text-sm font-medium tabular-nums">
          {formatUsd(totalUsd)}
        </td>
        <td className="px-4 py-2 text-right text-sm font-medium tabular-nums">
          {formatPercent(totalPct)}
        </td>
      </tr>
    </>
  );
}

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

function AssetRow({
  asset,
  active,
  onHover,
}: {
  asset: V2ReserveResponse["collateral"]["assets"][number];
  active: string | undefined;
  onHover: (name: string | undefined) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasSources = asset.sources.length > 0;

  return (
    <>
      <tr
        className={`border-b border-[var(--border)] transition-colors hover:bg-accent ${hasSources ? "cursor-pointer" : ""} ${asset.symbol === active ? "bg-accent" : ""}`}
        onClick={() => hasSources && setExpanded(!expanded)}
        onMouseEnter={() => onHover(asset.symbol)}
        onMouseLeave={() => onHover(undefined)}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-3">
            {hasSources && (
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
          {formatNumber(asset.balance, 2)}
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          {formatUsd(asset.usd_value)}
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          {formatPercent(asset.percentage)}
        </td>
      </tr>

      {/* Sources breakdown */}
      {expanded &&
        asset.sources.map((s, i) => (
          <tr
            key={`${s.identifier}-${i}`}
            className="border-b border-[var(--border)] bg-[#15111b]/50"
          >
            <td className="px-4 py-2 pl-16">
              <div className="flex items-center gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${SOURCE_TYPE_COLOR[s.type] ?? "bg-muted text-muted-foreground"}`}
                >
                  {SOURCE_TYPE_LABEL[s.type] ?? s.type}
                </span>
                <span className="text-sm text-muted-foreground">
                  {s.label}
                </span>
              </div>
            </td>
            <td className="px-4 py-2 text-right tabular-nums text-sm text-muted-foreground">
              {formatNumber(s.balance, 2)}
            </td>
            <td className="px-4 py-2 text-right tabular-nums text-sm text-muted-foreground">
              {formatUsd(s.usd_value)}
            </td>
            <td className="px-4 py-2" />
          </tr>
        ))}
    </>
  );
}
