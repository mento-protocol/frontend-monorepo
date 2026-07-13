"use client";

import { formatUsd } from "@/lib/format";
import { InfoTooltip } from "../../info-tooltip";

export function ReserveHeldSummary({
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
