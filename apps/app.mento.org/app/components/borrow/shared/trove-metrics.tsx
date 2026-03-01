import type { LoanDetails, DebtTokenConfig } from "@repo/web3";
import { formatLtv, formatPrice, formatInterestRate } from "@repo/web3";
import { RiskBadge } from "./risk-badge";

interface TroveMetricsProps {
  loanDetails: LoanDetails | null;
  debtToken: DebtTokenConfig;
}

const PLACEHOLDER = "—";

const STATUS_LABELS: Record<string, string> = {
  healthy: "Healthy",
  "at-risk": "At Risk",
  liquidatable: "Liquidatable",
  underwater: "Underwater",
};

function MetricItem({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-sm font-medium">{children}</span>
    </div>
  );
}

export function TroveMetrics({ loanDetails, debtToken }: TroveMetricsProps) {
  if (!loanDetails) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricItem label="LTV">{PLACEHOLDER}</MetricItem>
        <MetricItem label="Liquidation Price">{PLACEHOLDER}</MetricItem>
        <MetricItem label="Interest Rate">{PLACEHOLDER}</MetricItem>
        <MetricItem label="Status">{PLACEHOLDER}</MetricItem>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <MetricItem label="LTV">
        <span className="flex items-center gap-2">
          {formatLtv(loanDetails.ltv)}
          <RiskBadge risk={loanDetails.liquidationRisk} />
        </span>
      </MetricItem>
      <MetricItem label="Liquidation Price">
        {formatPrice(loanDetails.liquidationPrice, debtToken)}
      </MetricItem>
      <MetricItem label="Interest Rate">
        {formatInterestRate(loanDetails.interestRate)}
      </MetricItem>
      <MetricItem label="Status">
        {loanDetails.status
          ? STATUS_LABELS[loanDetails.status] ?? loanDetails.status
          : PLACEHOLDER}
      </MetricItem>
    </div>
  );
}
