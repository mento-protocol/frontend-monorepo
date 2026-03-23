"use client";

import { useSetAtom } from "jotai";
import { Button, TokenIcon } from "@repo/ui";
import type { BorrowPosition, DebtTokenConfig, RiskLevel } from "@repo/web3";
import {
  useLoanDetails,
  formatCollateralAmount,
  formatDebtAmount,
  formatPrice,
  formatInterestRate,
} from "@repo/web3";
import { useChainId } from "@repo/web3/wagmi";
import { getTokenAddress, type TokenSymbol } from "@mento-protocol/mento-sdk";
import type { Address } from "viem";
import { borrowViewAtom } from "../atoms/borrow-navigation";
import { TroveStatusBadge } from "../shared/trove-status-badge";
import { TroveIdPopover } from "../shared/trove-id-popover";

const COLLATERAL_SYMBOL = "USDm";

interface TroveCardProps {
  position: BorrowPosition;
  debtToken: DebtTokenConfig;
}

const RISK_STYLES: Record<
  RiskLevel,
  { label: string; textClass: string; bgClass: string; barColor: string }
> = {
  low: {
    label: "Healthy",
    textClass: "text-green-500",
    bgClass: "bg-green-500/10 text-green-500",
    barColor: "bg-green-500",
  },
  medium: {
    label: "Moderate",
    textClass: "text-amber-400",
    bgClass: "bg-amber-400/10 text-amber-400",
    barColor: "bg-amber-400",
  },
  high: {
    label: "At Risk",
    textClass: "text-red-500",
    bgClass: "bg-red-500/10 text-red-500",
    barColor: "bg-red-500",
  },
};

function getLtvPercent(ltv: bigint | null | undefined): number | null {
  if (ltv == null) return null;
  const divisor = 10n ** 18n;
  return Number((ltv * 10000n) / divisor) / 100;
}

function LtvHealthBar({
  ltv,
  risk,
  maxLtv,
}: {
  ltv: bigint | null | undefined;
  risk: RiskLevel | null;
  maxLtv: bigint;
}) {
  const ltvPct = getLtvPercent(ltv);
  const maxLtvPct = getLtvPercent(maxLtv);
  const riskStyle = risk ? RISK_STYLES[risk] : RISK_STYLES.low;

  if (ltvPct == null || maxLtvPct == null) return null;

  const fillWidth = Math.min((ltvPct / maxLtvPct) * 100, 100);

  return (
    <div className="p-4 rounded-lg border border-border/50 bg-muted/30">
      {/* LTV value + risk label + liquidation threshold */}
      <div className="mb-2 flex items-baseline justify-between">
        <div className="gap-2 flex items-baseline">
          <span
            className={`text-2xl font-bold tracking-tight ${riskStyle.textClass}`}
          >
            {ltvPct.toFixed(1)}%
          </span>
          <span
            className={`px-2 py-0.5 rounded font-semibold tracking-wider font-mono text-[11px] uppercase ${riskStyle.bgClass}`}
          >
            {riskStyle.label}
          </span>
        </div>
        <span className="font-mono text-[11px] text-muted-foreground/50">
          Liq. at {maxLtvPct.toFixed(0)}%
        </span>
      </div>

      {/* Health bar */}
      <div className="h-1.5 relative w-full overflow-hidden rounded-full bg-muted/50">
        {/* Colored fill */}
        <div
          className={`inset-y-0 left-0 absolute rounded-full transition-all duration-500 ${riskStyle.barColor}`}
          style={{ width: `${fillWidth}%` }}
        />
      </div>
    </div>
  );
}

export function TroveCard({ position, debtToken }: TroveCardProps) {
  const setBorrowView = useSetAtom(borrowViewAtom);
  const chainId = useChainId();

  const loanDetails = useLoanDetails(
    position.collateral,
    position.debt,
    position.annualInterestRate,
    debtToken.symbol,
  );

  const collateralAddress = getTokenAddress(
    chainId,
    COLLATERAL_SYMBOL as TokenSymbol,
  ) as Address | undefined;

  const debtTokenAddress = getTokenAddress(
    chainId,
    debtToken.symbol as TokenSymbol,
  ) as Address | undefined;

  function handleManage() {
    setBorrowView({ view: "manage-trove", troveId: position.troveId });
  }

  const risk = loanDetails?.liquidationRisk ?? null;
  const riskStyle = risk ? RISK_STYLES[risk] : null;

  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-card transition-colors hover:bg-accent/30">
      {/* Top accent line */}
      {riskStyle && (
        <div
          className={`top-0 left-0 right-0 h-0.5 absolute ${riskStyle.barColor} opacity-50`}
        />
      )}

      <div className="p-6 space-y-5">
        {/* Header: Token pair + APR + Manage */}
        <div className="flex items-center justify-between">
          <div className="gap-3 flex items-center">
            {/* Overlapping token icons */}
            <div className="h-8 w-11 relative">
              {collateralAddress && (
                <TokenIcon
                  token={{
                    address: collateralAddress,
                    symbol: COLLATERAL_SYMBOL,
                  }}
                  size={32}
                  className="left-0 top-0 absolute z-10 rounded-full ring-2 ring-card"
                />
              )}
              {debtTokenAddress && (
                <TokenIcon
                  token={{
                    address: debtTokenAddress,
                    symbol: debtToken.symbol,
                  }}
                  size={32}
                  className="top-0 absolute left-[18px] rounded-full ring-2 ring-card"
                />
              )}
            </div>
            <div>
              <div className="gap-1.5 flex items-center">
                <span className="font-semibold">
                  {COLLATERAL_SYMBOL} / {debtToken.symbol}
                </span>
                <TroveIdPopover troveId={position.troveId} />
              </div>
              <div className="gap-2 flex flex-wrap items-center">
                <span className="font-mono text-[11px] text-muted-foreground/50">
                  Trove #{position.troveId.slice(0, 8)}
                </span>
                <TroveStatusBadge status={position.status} />
              </div>
            </div>
          </div>

          <div className="gap-3 flex items-center">
            <span className="font-mono text-[11px] text-muted-foreground/50">
              {formatInterestRate(position.annualInterestRate)} APR
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-9"
              onClick={handleManage}
            >
              Manage
            </Button>
          </div>
        </div>

        {/* LTV Health Bar */}
        {loanDetails && (
          <LtvHealthBar
            ltv={loanDetails.ltv}
            risk={loanDetails.liquidationRisk}
            maxLtv={loanDetails.maxLtv}
          />
        )}

        {/* Data row: Collateral, Debt, Liq. Price */}
        <div className="gap-6 grid grid-cols-3">
          <DataCell
            label="Collateral"
            value={formatCollateralAmount(position.collateral)}
          />
          <DataCell
            label="Debt"
            value={formatDebtAmount(position.debt, debtToken)}
          />
          <DataCell
            label="Liq. Price"
            value={formatPrice(
              loanDetails?.liquidationPrice ?? null,
              debtToken,
            )}
          />
        </div>
      </div>
    </div>
  );
}

function DataCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="font-medium tracking-widest font-mono text-[11px] text-muted-foreground/50 uppercase">
        {label}
      </span>
      <div className="mt-1 font-semibold tracking-tight">{value}</div>
    </div>
  );
}
