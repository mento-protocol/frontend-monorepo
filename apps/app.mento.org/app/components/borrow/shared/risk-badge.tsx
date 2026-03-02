import { Badge } from "@repo/ui";
import type { RiskLevel } from "@repo/web3";

const RISK_CONFIG: Record<RiskLevel, { label: string; className: string }> = {
  low: {
    label: "Low Liquidation Risk",
    className: "bg-green-100 text-green-800 border-green-200",
  },
  medium: {
    label: "Med Liquidation Risk",
    className: "bg-amber-100 text-amber-800 border-amber-200",
  },
  high: {
    label: "High Liquidation Risk",
    className: "bg-red-100 text-red-800 border-red-200",
  },
};

interface RiskBadgeProps {
  risk: RiskLevel | null;
}

export function RiskBadge({ risk }: RiskBadgeProps) {
  if (!risk) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        N/A
      </Badge>
    );
  }

  const config = RISK_CONFIG[risk];

  return (
    <Badge variant="outline" className={config.className}>
      {config.label}
    </Badge>
  );
}
