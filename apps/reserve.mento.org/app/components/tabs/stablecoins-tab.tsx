"use client";

import { useState } from "react";
import Image from "next/image";
import type { V2StablecoinsResponse } from "@/lib/types";
import { formatUsd, formatNumber, formatPercent } from "@/lib/format";
import { IconInfo } from "@repo/ui";
import { Tooltip, TooltipTrigger, TooltipContent } from "@repo/ui";

export function StablecoinsTab({
  stablecoins,
}: {
  stablecoins: V2StablecoinsResponse;
}) {
  const reserveCoins = stablecoins.stablecoins
    .filter((c) => c.backing_type === "reserve")
    .sort((a, b) => b.supply.total_usd - a.supply.total_usd);

  const cdpCoins = stablecoins.stablecoins
    .filter((c) => c.backing_type === "cdp")
    .sort((a, b) => b.supply.total_usd - a.supply.total_usd);

  const reserveDebtTotal = reserveCoins.reduce(
    (s, c) => s + c.supply.debt_usd,
    0,
  );
  const reserveHeldTotal = reserveCoins.reduce(
    (s, c) => s + c.supply.reserve_held_usd,
    0,
  );
  const reserveSupplyTotal = reserveCoins.reduce(
    (s, c) => s + c.supply.total_usd - c.supply.lost_usd,
    0,
  );
  const reservePct = reserveCoins.reduce(
    (s, c) => s + c.market_cap_percentage,
    0,
  );

  const cdpDebtTotal = cdpCoins.reduce((s, c) => s + c.supply.debt_usd, 0);
  const cdpHeldTotal = cdpCoins.reduce(
    (s, c) => s + c.supply.reserve_held_usd,
    0,
  );
  const cdpSupplyTotal = cdpCoins.reduce(
    (s, c) => s + c.supply.total_usd - c.supply.lost_usd,
    0,
  );
  const cdpPct = cdpCoins.reduce((s, c) => s + c.market_cap_percentage, 0);

  const grandTotalSupply = stablecoins.stablecoins.reduce(
    (s, c) => s + c.supply.total_usd - c.supply.lost_usd,
    0,
  );

  return (
    <div>
      <h2 className="my-6 text-2xl font-medium md:mb-8 md:block hidden">
        Mento Stablecoins
      </h2>
      <p className="mb-6 max-w-xl text-sm text-muted-foreground">
        Debt is the circulating supply redeemable by the public. Reserve-held
        supply sits in reserve wallets and LP positions and is not counted as a
        liability. Click a row to see the per-network breakdown.
      </p>

      <div className="overflow-x-auto">
        <table className="text-lg w-full min-w-[800px]">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Token</th>
              <th className="px-4 py-3 font-medium">Backing</th>
              <th className="px-4 py-3 font-medium">Networks</th>
              <th className="px-4 py-3 font-medium text-right">Debt</th>
              <th className="px-4 py-3 font-medium text-right">Reserve-Held</th>
              <th className="px-4 py-3 font-medium text-right">Total Supply</th>
              <th className="px-4 py-3 font-medium text-right">% of MCap</th>
            </tr>
          </thead>
          <tbody>
            {/* Reserve-backed */}
            {reserveCoins.map((coin) => (
              <CoinRow key={coin.symbol} coin={coin} />
            ))}

            {/* Reserve subtotal */}
            <tr className="border-l-4 border-l-[#8c35fd] bg-card">
              <td colSpan={3} className="px-4 py-3 font-medium">
                Reserve Total — {reserveCoins.length} stablecoins
              </td>
              <td className="px-4 py-3 font-medium text-right tabular-nums">
                {formatUsd(reserveDebtTotal)}
              </td>
              <td className="px-4 py-3 font-medium text-right tabular-nums">
                {formatUsd(reserveHeldTotal)}
              </td>
              <td className="px-4 py-3 font-medium text-right tabular-nums">
                {formatUsd(reserveSupplyTotal)}
              </td>
              <td className="px-4 py-3 font-medium text-right tabular-nums">
                {formatPercent(reservePct)}
              </td>
            </tr>

            {/* CDP-backed */}
            {cdpCoins.map((coin) => (
              <CoinRow key={coin.symbol} coin={coin} />
            ))}

            {/* CDP subtotal */}
            {cdpCoins.length > 0 && (
              <tr className="border-l-amber-500 border-l-4 bg-card">
                <td colSpan={3} className="px-4 py-3 font-medium">
                  CDP Total — {cdpCoins.length}{" "}
                  {cdpCoins.length === 1 ? "stablecoin" : "stablecoins"}
                </td>
                <td className="px-4 py-3 font-medium text-right tabular-nums">
                  {formatUsd(cdpDebtTotal)}
                </td>
                <td className="px-4 py-3 font-medium text-right tabular-nums">
                  {formatUsd(cdpHeldTotal)}
                </td>
                <td className="px-4 py-3 font-medium text-right tabular-nums">
                  {formatUsd(cdpSupplyTotal)}
                </td>
                <td className="px-4 py-3 font-medium text-right tabular-nums">
                  {formatPercent(cdpPct)}
                </td>
              </tr>
            )}

            {/* Grand total */}
            <tr className="border-t border-[var(--border)] bg-card">
              <td colSpan={3} className="px-4 py-3 font-medium">
                Total
              </td>
              <td className="px-4 py-3 font-medium text-right tabular-nums">
                {formatUsd(stablecoins.total_debt_usd)}
              </td>
              <td className="px-4 py-3 font-medium text-right tabular-nums">
                {formatUsd(reserveHeldTotal + cdpHeldTotal)}
              </td>
              <td className="px-4 py-3 font-medium text-right tabular-nums">
                {formatUsd(grandTotalSupply)}
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

function CoinRow({
  coin,
}: {
  coin: V2StablecoinsResponse["stablecoins"][number];
}) {
  const [expanded, setExpanded] = useState(false);
  const hasMultipleNetworks = coin.network_supplies.length > 1;
  const toggle = () => hasMultipleNetworks && setExpanded((v) => !v);

  return (
    <>
      <tr
        className={`border-b border-[var(--border)] transition-colors hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ring)] ${hasMultipleNetworks ? "cursor-pointer" : ""}`}
        onClick={toggle}
        role={hasMultipleNetworks ? "button" : undefined}
        tabIndex={hasMultipleNetworks ? 0 : undefined}
        aria-expanded={hasMultipleNetworks ? expanded : undefined}
        onKeyDown={(e) => {
          if (!hasMultipleNetworks) return;
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <td className="px-4 py-3">
          <div className="gap-3 flex items-center">
            {hasMultipleNetworks && (
              <span
                className={`text-xs text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
              >
                ▶
              </span>
            )}
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
            <div>
              <span className="font-medium">{coin.symbol}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {coin.name}
              </span>
            </div>
          </div>
        </td>
        <td className="px-4 py-3">
          <span
            className={`rounded px-1.5 py-0.5 font-medium text-[10px] ${
              coin.backing_type === "cdp"
                ? "bg-amber-500/20 text-amber-400"
                : "bg-[#8c35fd]/20 text-[#8c35fd]"
            }`}
          >
            {coin.backing_type === "cdp" ? "CDP" : "Reserve"}
          </span>
        </td>
        <td className="px-4 py-3">
          <div className="gap-1 flex flex-wrap">
            {coin.networks.map((n) => (
              <NetworkLabel key={n} chain={n} />
            ))}
          </div>
        </td>
        <SupplyCell amount={coin.supply.debt} usd={coin.supply.debt_usd} />
        <SupplyCell
          amount={coin.supply.reserve_held}
          usd={coin.supply.reserve_held_usd}
        />
        <SupplyCell
          amount={String(
            parseFloat(coin.supply.total) - parseFloat(coin.supply.lost),
          )}
          usd={coin.supply.total_usd - coin.supply.lost_usd}
          lostNote={
            coin.supply.lost_usd > 0
              ? `Excluding ${formatNumber(coin.supply.lost)} lost or inaccessible tokens (${formatUsd(coin.supply.lost_usd)})`
              : undefined
          }
        />
        <td className="px-4 py-3 text-right tabular-nums">
          {formatPercent(coin.market_cap_percentage)}
        </td>
      </tr>

      {/* Per-network breakdown rows */}
      {expanded &&
        coin.network_supplies.map((ns) => (
          <tr
            key={ns.chain}
            className="border-b border-[var(--border)] bg-[#15111b]/50"
          >
            <td className="px-4 py-2 pl-16">
              <div className="gap-2 flex items-center">
                <NetworkLabel chain={ns.chain} />
                <span className="text-xs font-mono max-w-[120px] truncate text-muted-foreground">
                  {ns.address.slice(0, 6)}...{ns.address.slice(-4)}
                </span>
              </div>
            </td>
            <td className="px-4 py-2" />
            <td className="px-4 py-2" />
            <SupplyCell
              amount={ns.supply.debt}
              usd={ns.supply.debt_usd}
              muted
            />
            <SupplyCell
              amount={ns.supply.reserve_held}
              usd={ns.supply.reserve_held_usd}
              muted
            />
            <SupplyCell
              amount={String(
                parseFloat(ns.supply.total) - parseFloat(ns.supply.lost),
              )}
              usd={ns.supply.total_usd - ns.supply.lost_usd}
              muted
            />
            <td className="px-4 py-2" />
          </tr>
        ))}
    </>
  );
}

function SupplyCell({
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
    <td
      className={`px-4 ${muted ? "py-2" : "py-3"} text-right tabular-nums ${muted ? "text-sm text-muted-foreground" : ""}`}
    >
      <div>
        {formatNumber(amount)}
        {lostNote && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={lostNote}
                className="ml-1 inline-flex cursor-help rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
              >
                <IconInfo />
              </button>
            </TooltipTrigger>
            <TooltipContent hideArrow className="max-w-xs">
              {lostNote}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <div
        className={`text-xs ${muted ? "text-muted-foreground/70" : "text-muted-foreground"}`}
      >
        = {formatUsd(usd)}
      </div>
    </td>
  );
}

function NetworkLabel({ chain }: { chain: string }) {
  const labels: Record<string, string> = {
    celo: "Celo",
    ethereum: "Ethereum",
    monad: "Monad",
    bitcoin: "Bitcoin",
  };
  return (
    <span className="rounded px-1.5 py-0.5 font-medium bg-muted text-[10px] text-muted-foreground">
      {labels[chain] ?? chain}
    </span>
  );
}
