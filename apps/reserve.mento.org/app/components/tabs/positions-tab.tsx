"use client";

import Image from "next/image";
import type { V2ReserveResponse } from "@/lib/types";
import { formatUsd, formatNumber, formatPercent } from "@/lib/format";
import { getBlockExplorerUrl } from "@/lib/format";

export function PositionsTab({
  reserve,
}: {
  reserve: V2ReserveResponse;
}) {
  return (
    <div className="gap-12 flex flex-col">
      <LpPositionsSection positions={reserve.lp_positions} />
      <OperationalHoldingsSection holdings={reserve.operational_holdings} />
      <CdpTrovesSection troves={reserve.cdp_troves} />
    </div>
  );
}

/* ──────────────── FPMM LP Positions ──────────────── */

function LpPositionsSection({
  positions,
}: {
  positions: V2ReserveResponse["lp_positions"];
}) {
  return (
    <div>
      <h2 className="mb-2 text-2xl font-medium">FPMM Liquidity Positions</h2>
      <p className="mb-6 max-w-xl text-sm text-muted-foreground">
        Reserve-held LP positions in Fixed Product Market Maker pools. Mento
        stablecoins in these positions are not counted as reserve liabilities.
      </p>

      <div className="gap-2 flex flex-col">
        {positions.positions.map((pos, i) => (
          <div
            key={`${pos.pool_name}-${pos.chain}-${i}`}
            className="bg-card p-4 xl:grid-cols-12 grid w-full grid-cols-2 gap-4 border-l-4 border-green-500/60 hover:bg-accent"
          >
            <div className="gap-3 text-lg font-medium xl:col-span-3 col-span-2 flex flex-row items-center justify-start">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-green-500/10 text-xs font-bold text-green-400">
                LP
              </span>
              {pos.pool_name}
            </div>
            <div className="gap-2 text-sm xl:col-span-2 col-span-1 flex flex-row items-center justify-start">
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {pos.chain === "celo"
                  ? "Celo"
                  : pos.chain === "monad"
                    ? "Monad"
                    : pos.chain}
              </span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {pos.pool_type}
              </span>
            </div>
            <div className="gap-2 text-sm xl:col-span-2 col-span-1 flex flex-row items-center justify-start text-white">
              {formatUsd(pos.reserve_liquidity_usd)}
            </div>
            <div className="gap-2 text-sm xl:col-span-2 col-span-1 flex flex-row items-center justify-start text-muted-foreground">
              {formatNumber(pos.token_a.amount)}{" "}
              {pos.token_a.symbol.replace(" (reserve-held)", "").replace(" (collateral)", "")}
              {" / "}
              {formatNumber(pos.token_b.amount)}{" "}
              {pos.token_b.symbol.replace(" (reserve-held)", "").replace(" (collateral)", "")}
            </div>
            <div className="gap-2 text-sm lg:justify-end lg:pr-4 xl:col-span-3 col-span-1 flex flex-row items-center justify-start text-muted-foreground">
              {formatPercent(pos.pool_share_pct)} pool share
            </div>
          </div>
        ))}

        {/* Total */}
        <div className="bg-card p-4 flex items-center justify-between border-l-4 border-green-500/60">
          <span className="text-sm font-medium text-muted-foreground">
            {positions.positions.length} LP positions
          </span>
          <span className="text-sm font-medium">
            {formatUsd(positions.total_usd)} total reserve liquidity
          </span>
        </div>
      </div>
    </div>
  );
}

/* ──────────────── Operational Holdings ──────────────── */

function OperationalHoldingsSection({
  holdings,
}: {
  holdings: V2ReserveResponse["operational_holdings"];
}) {
  return (
    <div>
      <h2 className="mb-2 text-2xl font-medium">Operational Holdings</h2>
      <p className="mb-6 max-w-xl text-sm text-muted-foreground">
        Mento stablecoins held in reserve wallets. Not counted as reserve
        liabilities.
      </p>

      <div className="gap-2 flex flex-col">
        {holdings.holdings.map((h, i) => (
          <div
            key={`${h.token}-${h.wallet_label}-${i}`}
            className="bg-card p-4 xl:grid-cols-12 grid w-full grid-cols-2 gap-4 border-l-4 border-[#8c35fd]/40 hover:bg-accent"
          >
            <div className="gap-4 text-lg font-medium xl:col-span-3 col-span-2 flex flex-row items-center justify-start">
              <Image
                src={`/tokens/${h.token}.svg`}
                alt={h.token}
                width={24}
                height={24}
                className="h-9 w-9"
                onError={(e) => {
                  e.currentTarget.src = "/tokens/CELO.svg";
                }}
              />
              {h.token}
            </div>
            <div className="gap-2 text-sm xl:col-span-3 col-span-1 flex flex-row items-center justify-start">
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {h.chain === "celo" ? "Celo" : h.chain}
              </span>
              <span className="text-muted-foreground">{h.wallet_label}</span>
            </div>
            <div className="gap-2 text-sm text-white xl:col-span-3 col-span-1 flex flex-row items-center justify-start">
              {formatNumber(h.balance)}
            </div>
            <div className="gap-2 text-sm lg:justify-end lg:pr-4 xl:col-span-3 col-span-2 flex flex-row items-center justify-start text-muted-foreground">
              {formatUsd(h.usd_value)}
            </div>
          </div>
        ))}

        {/* Total */}
        <div className="bg-card p-4 flex items-center justify-between border-l-4 border-[#8c35fd]/40">
          <span className="text-sm font-medium text-muted-foreground">
            {holdings.holdings.length} holdings across{" "}
            {new Set(holdings.holdings.map((h) => h.token)).size} tokens
          </span>
          <span className="text-sm font-medium">
            {formatUsd(holdings.total_usd)}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ──────────────── CDP Trove Positions ──────────────── */

function CdpTrovesSection({
  troves,
}: {
  troves: V2ReserveResponse["cdp_troves"];
}) {
  const activeTroves = troves.troves.filter((t) => t.status === "active");

  // Known upcoming troves not yet in the API
  const comingSoon = ["CHFm", "JPYm"].filter(
    (s) => !troves.troves.some((t) => t.stablecoin === s),
  );

  return (
    <div>
      <h2 className="mb-2 text-2xl font-medium">CDP Trove Positions</h2>
      <p className="mb-6 max-w-xl text-sm text-muted-foreground">
        Active collateralized debt positions. Collateral deposited in CDPs backs
        the minted stablecoins.
      </p>

      <div className="gap-2 md:gap-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {activeTroves.map((trove) => (
          <div
            key={trove.stablecoin}
            className="bg-card border-l-4 border-amber-500"
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] p-4">
              <div className="gap-3 flex items-center">
                <Image
                  src={`/tokens/${trove.stablecoin}.svg`}
                  alt={trove.stablecoin}
                  width={24}
                  height={24}
                  className="h-7 w-7"
                  onError={(e) => {
                    e.currentTarget.src = "/tokens/CELO.svg";
                  }}
                />
                <span className="font-medium">{trove.stablecoin} Trove</span>
              </div>
              <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-[10px] font-medium text-green-400">
                ACTIVE
              </span>
            </div>
            <div className="p-4">
              <div className="gap-4 grid grid-cols-2">
                <div>
                  <span className="text-xs text-muted-foreground">
                    Collateral
                  </span>
                  <p className="mt-0.5 font-medium">
                    {formatUsd(trove.collateral_usd)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatNumber(trove.collateral_amount)}{" "}
                    {trove.collateral_token}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">
                    Debt Minted
                  </span>
                  <p className="mt-0.5 font-medium">
                    {formatUsd(trove.debt_usd)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatNumber(trove.debt_amount)} {trove.stablecoin}
                  </p>
                </div>
              </div>
              <div className="mt-4 gap-4 grid grid-cols-2">
                <div>
                  <span className="text-xs text-muted-foreground">Ratio</span>
                  <p className="mt-0.5 font-medium text-green-400">
                    {trove.ratio.toFixed(2)}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">
                    Liquidation
                  </span>
                  <p className="mt-0.5 font-medium">
                    {trove.liquidation_price > 0
                      ? `$${trove.liquidation_price.toFixed(2)}`
                      : "--"}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3">
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {trove.chain === "celo" ? "Celo" : trove.chain}
              </span>
              <a
                href={getBlockExplorerUrl(trove.chain, trove.contract_address)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[#8c35fd] underline transition-colors hover:text-[#a855f7]"
              >
                View Contract
              </a>
            </div>
          </div>
        ))}

        {/* Pending/Coming soon */}
        {troves.troves
          .filter((t) => t.status === "pending")
          .map((trove) => (
            <PendingTroveCard key={trove.stablecoin} symbol={trove.stablecoin} />
          ))}
        {comingSoon.map((symbol) => (
          <PendingTroveCard key={symbol} symbol={symbol} />
        ))}
      </div>
    </div>
  );
}

function PendingTroveCard({ symbol }: { symbol: string }) {
  return (
    <div className="bg-card border-l-4 border-amber-500/30 opacity-50">
      <div className="flex items-center justify-between border-b border-[var(--border)] p-4">
        <div className="gap-3 flex items-center">
          <Image
            src={`/tokens/${symbol}.svg`}
            alt={symbol}
            width={24}
            height={24}
            className="h-7 w-7"
            onError={(e) => {
              e.currentTarget.src = "/tokens/CELO.svg";
            }}
          />
          <span className="font-medium">{symbol} Trove</span>
        </div>
        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
          SOON
        </span>
      </div>
      <div className="p-4">
        <div className="gap-4 grid grid-cols-2">
          <div>
            <span className="text-xs text-muted-foreground">Collateral</span>
            <p className="mt-0.5 font-medium text-muted-foreground">--</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Debt Minted</span>
            <p className="mt-0.5 font-medium text-muted-foreground">--</p>
          </div>
        </div>
      </div>
    </div>
  );
}
