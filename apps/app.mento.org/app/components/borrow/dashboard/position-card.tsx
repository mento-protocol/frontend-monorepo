"use client";

import { useState } from "react";
import { useSetAtom } from "jotai";
import { Card, CardContent, CardHeader, CardTitle, CardAction } from "@repo/ui";
import type { BorrowPosition, DebtTokenConfig } from "@repo/web3";
import {
  useLoanDetails,
  formatCollateralAmount,
  formatDebtAmount,
  formatLtv,
  formatPrice,
  formatInterestRate,
} from "@repo/web3";
import { Copy, Check } from "lucide-react";
import { RiskBadge } from "../shared/risk-badge";
import { borrowViewAtom } from "../atoms/borrow-navigation";

function shortenId(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}...${id.slice(-6)}`;
}

interface PositionCardProps {
  position: BorrowPosition;
  debtToken: DebtTokenConfig;
}

export function PositionCard({ position, debtToken }: PositionCardProps) {
  const setBorrowView = useSetAtom(borrowViewAtom);
  const [copied, setCopied] = useState(false);

  const loanDetails = useLoanDetails(
    position.collateral,
    position.debt,
    position.annualInterestRate,
    debtToken.symbol,
  );

  function handleClick() {
    setBorrowView({ view: "manage-trove", troveId: position.troveId });
  }

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(position.troveId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card
      className="hover:shadow-md cursor-pointer transition-shadow"
      onClick={handleClick}
    >
      <CardHeader>
        <div className="gap-1.5 flex items-center">
          <CardTitle className="shrink-0">Trove</CardTitle>
          <span className="text-xs font-mono text-muted-foreground">
            {shortenId(position.troveId)}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="p-0.5 rounded text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Copy trove ID"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-green-600" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
        <CardAction>
          <RiskBadge risk={loanDetails?.liquidationRisk ?? null} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="gap-x-6 gap-y-3 grid grid-cols-3">
          <Metric label="Collateral">
            {formatCollateralAmount(position.collateral)}
          </Metric>
          <Metric label="Debt">
            {formatDebtAmount(position.debt, debtToken)}
          </Metric>
          <Metric label="LTV">{formatLtv(loanDetails?.ltv ?? null)}</Metric>
          <Metric label="Liq. Price">
            {formatPrice(loanDetails?.liquidationPrice ?? null, debtToken)}
          </Metric>
          <Metric label="Interest Rate">
            {formatInterestRate(position.annualInterestRate)}
          </Metric>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="gap-0.5 flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{children}</span>
    </div>
  );
}
