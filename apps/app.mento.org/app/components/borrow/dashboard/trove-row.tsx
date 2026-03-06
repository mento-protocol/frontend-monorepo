"use client";

import { useSetAtom } from "jotai";
import { Button, TokenIcon } from "@repo/ui";
import type { BorrowPosition, DebtTokenConfig } from "@repo/web3";
import {
  useLoanDetails,
  formatCollateralAmount,
  formatDebtAmount,
  formatLtv,
  formatPrice,
  formatInterestRate,
} from "@repo/web3";
import { useChainId } from "@repo/web3/wagmi";
import { getTokenAddress, type TokenSymbol } from "@mento-protocol/mento-sdk";
import type { Address } from "viem";
import { RiskBadge } from "../shared/risk-badge";
import { TroveIdPopover } from "../shared/trove-id-popover";
import { borrowViewAtom } from "../atoms/borrow-navigation";

const COLLATERAL_SYMBOL = "USDm";

interface TroveRowProps {
  position: BorrowPosition;
  debtToken: DebtTokenConfig;
}

export function TroveRow({ position, debtToken }: TroveRowProps) {
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

  function handleClick() {
    setBorrowView({ view: "manage-trove", troveId: position.troveId });
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="gap-4 md:gap-6 px-4 py-4 md:grid md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,0.7fr)] md:items-center flex flex-col">
        {/* Trove - token icons */}
        <div className="gap-3 flex items-center">
          <div className="-space-x-2 flex">
            {collateralAddress && (
              <TokenIcon
                token={{
                  address: collateralAddress,
                  symbol: COLLATERAL_SYMBOL,
                }}
                size={32}
                className="relative z-10 rounded-full"
              />
            )}
            {debtTokenAddress && (
              <TokenIcon
                token={{
                  address: debtTokenAddress,
                  symbol: debtToken.symbol,
                }}
                size={32}
                className="rounded-full"
              />
            )}
          </div>
          <div className="gap-1 flex flex-col">
            <div className="gap-1.5 flex items-center">
              <span className="text-sm font-medium">
                {COLLATERAL_SYMBOL} / {debtToken.symbol}
              </span>
              <TroveIdPopover troveId={position.troveId} />
            </div>
          </div>
        </div>

        {/* Collateral */}
        <div className="flex flex-col">
          <span className="text-xs md:hidden text-muted-foreground">
            Collateral
          </span>
          <span className="text-sm font-medium font-mono tabular-nums">
            {formatCollateralAmount(position.collateral)}
          </span>
        </div>

        {/* Debt */}
        <div className="flex flex-col">
          <span className="text-xs md:hidden text-muted-foreground">Debt</span>
          <span className="text-sm font-medium font-mono tabular-nums">
            {formatDebtAmount(position.debt, debtToken)}
          </span>
        </div>

        {/* LTV */}
        <div className="flex flex-col">
          <span className="text-xs md:hidden text-muted-foreground">LTV</span>
          <span className="text-sm font-medium font-mono tabular-nums">
            {formatLtv(loanDetails?.ltv ?? null)}
          </span>
        </div>

        {/* Liq. Price */}
        <div className="flex flex-col">
          <span className="text-xs md:hidden text-muted-foreground">
            Liq. Price
          </span>
          <span className="text-sm font-medium font-mono tabular-nums">
            {formatPrice(loanDetails?.liquidationPrice ?? null, debtToken)}
          </span>
        </div>

        {/* Interest Rate */}
        <div className="flex flex-col">
          <span className="text-xs md:hidden text-muted-foreground">
            Interest
          </span>
          <span className="text-sm font-medium font-mono tabular-nums">
            {formatInterestRate(position.annualInterestRate)}
          </span>
        </div>

        {/* Risk */}
        <div className="flex items-center">
          <RiskBadge risk={loanDetails?.liquidationRisk ?? null} />
        </div>

        {/* Actions */}
        <div className="gap-2 md:justify-end flex items-center">
          <Button size="sm" className="h-8" onClick={handleClick}>
            Manage
          </Button>
        </div>
      </div>
    </div>
  );
}
