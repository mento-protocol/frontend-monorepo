import { Badge, Tooltip, TooltipTrigger, TooltipContent } from "@repo/ui";
import type { PriceAlignmentStatus } from "@repo/web3";

const statusConfig: Record<
  Exclude<PriceAlignmentStatus, "none">,
  { label: string; className: string; tooltip?: string }
> = {
  "in-band": {
    label: "In band",
    className:
      "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400",
    tooltip: "Pool price is within the acceptable range of the oracle price.",
  },
  warning: {
    label: "Warning",
    className:
      "border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-400",
    tooltip:
      "Pool price is drifting from the oracle price. A rebalance may occur soon.",
  },
  "rebalance-likely": {
    label: "Rebalance likely",
    className:
      "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400",
    tooltip:
      "Pool price has deviated significantly from the oracle. A rebalance will adjust reserves back toward the oracle price.",
  },
  "market-closed": {
    label: "Market closed",
    className: "border-border bg-muted/50 text-muted-foreground",
  },
};

export function PriceAlignmentBadge({
  status,
}: {
  status: PriceAlignmentStatus;
}) {
  const config = statusConfig[status as keyof typeof statusConfig];
  if (!config) return <span className="text-muted-foreground">&mdash;</span>;

  const badge = <Badge className={config.className}>{config.label}</Badge>;

  if (!config.tooltip) return badge;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-60">
        {config.tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
