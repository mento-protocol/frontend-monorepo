"use client";

import { IconInfo } from "@repo/ui";
import { Tooltip, TooltipTrigger, TooltipContent } from "@repo/ui";
import type { V2OverviewResponse } from "@/lib/types";
import { formatUsd } from "@/lib/format";

interface OverviewTabProps {
  overview: V2OverviewResponse;
  onNavigateToPositions: () => void;
}

export function OverviewTab({
  overview,
  onNavigateToPositions,
}: OverviewTabProps) {
  const { supply, reserve_backing, cdp_backings } = overview;
  const activeCdps = cdp_backings.filter((c) => c.status === "active");

  return (
    <div className="gap-8 flex flex-col">
      {/* Supply Decomposition */}
      <div>
        <h2 className="mb-6 text-2xl font-medium">Supply Breakdown</h2>
        {/* Desktop: horizontal with operators */}
        <div className="hidden md:flex md:items-center md:gap-3">
          <KpiCard
            label="Total Supply"
            value={formatUsd(supply.total_usd - supply.lost_usd)}
            tooltip={`The total supply of all Mento stablecoins across ${supply.stablecoin_count} stablecoins, excluding ${formatUsd(supply.lost_usd)} in lost or inaccessible assets.`}
            className="flex-1"
          />
          <Operator>=</Operator>
          <KpiCard
            label="Reserve Debt"
            value={formatUsd(supply.reserve_debt_usd)}
            tooltip="Mento stablecoins in public circulation, backed by the reserve and redeemable through the buy-and-sell mechanism."
            className="flex-1"
          />
          <Operator>+</Operator>
          <KpiCard
            label="CDP Debt"
            value={formatUsd(supply.cdp_debt_usd)}
            tooltip="Mento stablecoins in public circulation, minted through collateralized debt positions and backed by collateral deposited in on-chain CDPs."
            className="flex-1"
          />
          <Operator>+</Operator>
          <button
            type="button"
            onClick={onNavigateToPositions}
            className="cursor-pointer bg-card p-4 md:p-6 text-left transition-colors hover:bg-accent flex-1"
          >
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              Reserve Held Supply
              <InfoTooltip>
                Mento stablecoins held in reserve wallets and LP positions —
                not counted as reserve liabilities.
              </InfoTooltip>
            </span>
            <p className="mt-1 text-xl font-medium md:text-2xl">
              {formatUsd(supply.reserve_held_usd)}
            </p>
          </button>
        </div>

        {/* Mobile: stacked with operators between rows */}
        <div className="flex flex-col gap-2 md:hidden">
          <KpiCard
            label="Total Supply"
            value={formatUsd(supply.total_usd - supply.lost_usd)}
            tooltip={`The total supply of all Mento stablecoins across ${supply.stablecoin_count} stablecoins, excluding ${formatUsd(supply.lost_usd)} in lost or inaccessible assets.`}
          />
          <Operator>=</Operator>
          <div className="grid grid-cols-3 gap-2">
            <KpiCard
              label="Reserve Debt"
              value={formatUsd(supply.reserve_debt_usd, true)}
              tooltip="Mento stablecoins in public circulation, backed by the reserve and redeemable through the buy-and-sell mechanism."
            />
            <KpiCard
              label="CDP Debt"
              value={formatUsd(supply.cdp_debt_usd, true)}
              tooltip="Mento stablecoins in public circulation, minted through collateralized debt positions and backed by collateral deposited in on-chain CDPs."
            />
            <button
              type="button"
              onClick={onNavigateToPositions}
              className="cursor-pointer bg-card p-4 text-left transition-colors hover:bg-accent"
            >
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                Held
                <InfoTooltip>
                  Mento stablecoins held in reserve wallets and LP positions —
                  not counted as reserve liabilities.
                </InfoTooltip>
              </span>
              <p className="mt-1 text-lg font-medium">
                {formatUsd(supply.reserve_held_usd, true)}
              </p>
            </button>
          </div>
        </div>
      </div>

      {/* Backing Mechanisms */}
      <div>
        <h2 className="mb-6 text-2xl font-medium flex items-center gap-2">
          Backing
          <InfoTooltip>
            Each backing mechanism maintains its own collateralization ratio.
            Reserve-backed stablecoins are redeemable through the buy-and-sell
            mechanism. CDP-backed stablecoins are minted by depositing collateral
            in on-chain collateralized debt positions.
          </InfoTooltip>
        </h2>
        <div className="gap-2 md:gap-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          {/* Reserve-backed */}
          <div className="bg-card p-4 md:p-6 border-l-4 border-[#8c35fd]">
            <span className="text-sm text-muted-foreground">
              Reserve-Backed
            </span>
            <p className="mt-1 text-xl font-medium md:text-2xl">
              {formatUsd(reserve_backing.debt_usd)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {reserve_backing.stablecoin_count} stablecoins
            </p>
            <hr className="my-3 border-[var(--border)]" />
            <div className="gap-4 grid grid-cols-2">
              <div>
                <span className="text-xs text-muted-foreground">
                  Collateral
                </span>
                <p className="mt-0.5 text-sm font-medium">
                  {formatUsd(reserve_backing.collateral_usd)}
                </p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Ratio</span>
                <p className="mt-0.5 text-sm font-medium text-green-400">
                  {reserve_backing.ratio.toFixed(2)}
                </p>
              </div>
            </div>
          </div>

          {/* Active CDP cards */}
          {activeCdps.map((cdp) => (
            <div
              key={cdp.stablecoin}
              className="bg-card p-4 md:p-6 border-l-4 border-amber-500"
            >
              <span className="text-sm text-muted-foreground">
                {cdp.stablecoin} CDP
              </span>
              <p className="mt-1 text-xl font-medium md:text-2xl">
                {formatUsd(cdp.debt_usd)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {parseFloat(cdp.debt_amount).toLocaleString("en-US", {
                  maximumFractionDigits: 0,
                })}{" "}
                {cdp.stablecoin}
              </p>
              <hr className="my-3 border-[var(--border)]" />
              <div className="gap-4 grid grid-cols-2">
                <div>
                  <span className="text-xs text-muted-foreground">
                    Collateral
                  </span>
                  <p className="mt-0.5 text-sm font-medium">
                    {formatUsd(cdp.collateral_usd)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {parseFloat(cdp.collateral_amount).toLocaleString("en-US", {
                      maximumFractionDigits: 0,
                    })}{" "}
                    {cdp.collateral_token}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Ratio</span>
                  <p className="mt-0.5 text-sm font-medium text-green-400">
                    {cdp.ratio.toFixed(2)}
                  </p>
                </div>
              </div>
            </div>
          ))}

          {/* Coming soon CDPs */}
          {!cdp_backings.some((c) => c.stablecoin === "CHFm") && (
            <ComingSoonCard label="CHFm CDP" />
          )}
          {!cdp_backings.some((c) => c.stablecoin === "JPYm") && (
            <ComingSoonCard label="JPYm CDP" />
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({
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
    <div className={`bg-card p-4 md:p-6 ${className ?? ""}`}>
      <span className="text-sm text-muted-foreground flex items-center gap-1">
        {label}
        {tooltip && <InfoTooltip>{tooltip}</InfoTooltip>}
      </span>
      <p className="mt-1 text-xl font-medium md:text-2xl">{value}</p>
    </div>
  );
}

function Operator({ children }: { children: string }) {
  return (
    <span className="shrink-0 text-center text-lg font-light text-muted-foreground">
      {children}
    </span>
  );
}

function ComingSoonCard({ label }: { label: string }) {
  return (
    <div className="bg-card p-4 md:p-6 border-l-4 border-amber-500/30 opacity-50">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
          SOON
        </span>
      </div>
      <p className="mt-1 text-xl font-medium text-muted-foreground">--</p>
      <hr className="my-3 border-[var(--border)]" />
      <div className="gap-4 grid grid-cols-2">
        <div>
          <span className="text-xs text-muted-foreground">Collateral</span>
          <p className="mt-0.5 text-sm text-muted-foreground">--</p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">Ratio</span>
          <p className="mt-0.5 text-sm text-muted-foreground">--</p>
        </div>
      </div>
    </div>
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
